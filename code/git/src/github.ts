import { decodeBase64 } from "./base64.ts";
import { ConflictError, ForgeError } from "./errors.ts";
import { createHttpClient, type HttpClient } from "./http.ts";
import type {
  CommitComparison,
  CommitFilesOptions,
  CommitResult,
  FileContent,
  ForgeConfig,
  PublishingForge,
  RepoEntry,
} from "./types.ts";

interface GitHubContentsEntry {
  path: string;
  name: string;
  type: "file" | "dir" | "symlink" | "submodule";
  sha: string;
  size: number;
  content?: string;
}

export class GitHubForge implements PublishingForge {
  readonly kind = "github" as const;
  private readonly http: HttpClient;
  private readonly repoPath: string;
  private readonly owner: string;
  private readonly repository: string;

  constructor(config: ForgeConfig) {
    this.http = createHttpClient({
      apiBase: "https://api.github.com",
      token: config.token,
      headers: {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      ...(config.fetch ? { fetch: config.fetch } : {}),
    });
    this.owner = config.owner;
    this.repository = config.repo;
    this.repoPath = `/repos/${config.owner}/${config.repo}`;
  }

  async getFile(path: string, ref?: string): Promise<FileContent | null> {
    const query = ref ? `?ref=${encodeURIComponent(ref)}` : "";
    const response = await this.http.request(
      `${this.repoPath}/contents/${encodePath(path)}${query}`,
    );
    if (response.status === 404) {
      const error = (await response.json()) as { message?: unknown };
      if (
        ref &&
        /^[a-f0-9]{40}$/i.test(ref) &&
        typeof error.message === "string" &&
        error.message.startsWith("No commit found for the ref")
      ) {
        return this.committedFile(path, ref);
      }
      return null;
    }
    const entry = (await response.json()) as GitHubContentsEntry;
    if (entry.type !== "file" || entry.content === undefined) {
      throw new ForgeError(`${path} is not a file`, 422, path);
    }
    return { path: entry.path, sha: entry.sha, content: decodeBase64(entry.content) };
  }

  async getFiles(files: Array<{ path: string; ref: string }>): Promise<Array<FileContent | null>> {
    if (files.some(({ ref }) => !/^[a-f0-9]{40}$/i.test(ref)))
      throw new ForgeError("Batch reads require immutable commit SHAs", 422, this.repoPath);
    const result: Array<FileContent | null> = [];
    // At most three 30-object requests at once, with input ordering preserved.
    for (let offset = 0; offset < files.length; offset += 90) {
      const chunks = [0, 30, 60]
        .map((start) => files.slice(offset + start, offset + start + 30))
        .filter((chunk) => chunk.length);
      result.push(...(await Promise.all(chunks.map((chunk) => this.readBatch(chunk)))).flat());
    }
    return result;
  }
  private async readBatch(
    batch: Array<{ path: string; ref: string }>,
  ): Promise<Array<FileContent | null>> {
    const fields = batch
      .map(
        (_, i) =>
          `f${i}: object(expression: $e${i}) { __typename ... on Blob { oid text isTruncated } }`,
      )
      .join("\n");
    const variables = Object.fromEntries(
      batch.map((file, i) => [`e${i}`, `${file.ref}:${file.path}`]),
    );
    const response = await this.http.json<{
      errors?: unknown[];
      data?: {
        repository: Record<
          string,
          { __typename: string; oid: string; text: string | null; isTruncated: boolean } | null
        > | null;
      };
    }>("/graphql", {
      method: "POST",
      body: JSON.stringify({
        query: `query($owner: String!, $repo: String!, ${batch.map((_, i) => `$e${i}: String!`).join(", ")}) { repository(owner: $owner, name: $repo) { ${fields} } }`,
        variables: { owner: this.owner, repo: this.repository, ...variables },
      }),
    });
    if (response.errors?.length || !response.data?.repository)
      throw new ForgeError("GitHub batch read failed", 502, this.repoPath);
    return Promise.all(
      batch.map(async (file, i) => {
        const blob = response.data!.repository![`f${i}`];
        if (blob === undefined)
          throw new ForgeError("Incomplete GitHub batch response", 502, this.repoPath);
        if (!blob) return null;
        if (blob.__typename !== "Blob")
          throw new ForgeError(`${file.path} is not a file`, 422, file.path);
        return blob.isTruncated || blob.text === null
          ? this.getFile(file.path, file.ref)
          : { path: file.path, sha: blob.oid, content: blob.text };
      }),
    );
  }

  /** Contents can lag a newly written commit. Keep reads pinned to that exact Git object. */
  private async committedFile(path: string, ref: string): Promise<FileContent | null> {
    const tree = await this.http.json<{
      truncated: boolean;
      tree: Array<{ path: string; type: string; sha: string }>;
    }>(`${this.repoPath}/git/trees/${ref}?recursive=1`);
    if (tree.truncated)
      throw new ForgeError("Cannot resolve a file from a truncated Git tree", 422, path);
    const entry = tree.tree.find((item) => item.path === path);
    if (!entry) return null;
    if (entry.type !== "blob") throw new ForgeError(`${path} is not a file`, 422, path);
    const blob = await this.http.json<{ content: string; encoding: string }>(
      `${this.repoPath}/git/blobs/${entry.sha}`,
    );
    if (blob.encoding !== "base64")
      throw new ForgeError("Unsupported Git blob encoding", 422, path);
    return { path, sha: entry.sha, content: decodeBase64(blob.content) };
  }

  async getDirectoryFiles(path: string, ref: string): Promise<FileContent[]> {
    if (!/^[a-f0-9]{40}$/i.test(ref))
      throw new ForgeError("Directory reads require an immutable commit SHA", 422, this.repoPath);
    const response = await this.http.json<{
      errors?: unknown[];
      data?: {
        repository: {
          object: {
            __typename: string;
            entries?: Array<{
              name: string;
              type: string;
              object: { oid: string; text?: string | null; isTruncated?: boolean } | null;
            }> | null;
          } | null;
        } | null;
      };
    }>("/graphql", {
      method: "POST",
      body: JSON.stringify({
        query: `query($owner: String!, $repo: String!, $expression: String!) { repository(owner: $owner, name: $repo) { object(expression: $expression) { __typename ... on Tree { entries { name type object { oid ... on Blob { text isTruncated } } } } } } }`,
        variables: { owner: this.owner, repo: this.repository, expression: `${ref}:${path}` },
      }),
    });
    if (response.errors?.length || !response.data?.repository)
      throw new ForgeError("GitHub directory read failed", 502, this.repoPath);
    const tree = response.data.repository.object;
    if (tree === null) return [];
    if (tree?.__typename !== "Tree" || !Array.isArray(tree.entries))
      throw new ForgeError("Incomplete GitHub directory response", 502, this.repoPath);
    const result: FileContent[] = [];
    for (const entry of tree.entries.filter((item) => item.type === "blob")) {
      const filename = `${path}/${entry.name}`;
      if (!entry.object) throw new ForgeError("Missing GitHub directory blob", 502, filename);
      const file =
        entry.object.isTruncated || typeof entry.object.text !== "string"
          ? await this.getFile(filename, ref)
          : { path: filename, sha: entry.object.oid, content: entry.object.text };
      if (!file) throw new ForgeError("Missing GitHub directory file", 502, filename);
      result.push(file);
    }
    return result;
  }

  async listDir(path = "", ref?: string): Promise<RepoEntry[]> {
    const query = ref ? `?ref=${encodeURIComponent(ref)}` : "";
    const entries = await this.http.json<GitHubContentsEntry[]>(
      `${this.repoPath}/contents/${encodePath(path)}${query}`,
    );
    return entries
      .filter((entry) => entry.type === "file" || entry.type === "dir")
      .map((entry) => ({
        path: entry.path,
        name: entry.name,
        type: entry.type as "file" | "dir",
        sha: entry.sha,
        size: entry.size,
      }));
  }

  async getBranchSha(branch: string): Promise<string> {
    const ref = await this.http.json<{ object: { sha: string } }>(
      `${this.repoPath}/git/ref/heads/${encodePath(branch)}`,
    );
    return ref.object.sha;
  }

  async listBranches(prefix: string): Promise<Array<{ name: string; sha: string }>> {
    const branches: Array<{ name: string; sha: string }> = [];
    for (let page = 1; ; page++) {
      const entries = await this.http.json<Array<{ name: string; commit: { sha: string } }>>(
        `${this.repoPath}/branches?per_page=100&page=${page}`,
      );
      for (const entry of entries) {
        if (entry.name.startsWith(prefix))
          branches.push({ name: entry.name, sha: entry.commit.sha });
      }
      if (entries.length < 100) return branches;
    }
  }

  private async comparison(
    base: string,
    head: string,
  ): Promise<{
    status: string;
    ahead_by: number;
    files?: Array<{ filename: string; previous_filename?: string }>;
  }> {
    // The first page contains all comparison files (up to GitHub's 300-file cap),
    // regardless of how many commits are requested.
    return this.http.json(
      `${this.repoPath}/compare/${encodeURIComponent(base)}...${encodeURIComponent(head)}?per_page=1&page=1`,
    );
  }

  async compareCommits(baseSha: string, headSha: string): Promise<CommitComparison> {
    const result = await this.comparison(baseSha, headSha);
    if (!result.files || result.files.length >= 300) {
      throw new ForgeError(
        "Cannot verify complete publication scope: GitHub comparison files are missing or may be truncated",
        422,
        this.repoPath,
      );
    }
    return {
      status: result.status,
      aheadBy: result.ahead_by,
      files: result.files.map((file) => ({
        filename: file.filename,
        ...(file.previous_filename ? { previousFilename: file.previous_filename } : {}),
      })),
    };
  }

  async isAncestor(ancestor: string, head: string): Promise<boolean> {
    const result = await this.comparison(ancestor, head);
    return result.status === "ahead" || result.status === "identical";
  }

  async areAncestors(
    ancestors: string[],
    head: { branch: string; sha: string },
  ): Promise<boolean[]> {
    if ([head.sha, ...ancestors].some((sha) => !/^[a-f0-9]{40}$/i.test(sha)))
      throw new ForgeError("Ancestry checks require immutable commit SHAs", 422, this.repoPath);
    const result: boolean[] = [];
    for (let offset = 0; offset < ancestors.length; offset += 50) {
      const batch = ancestors.slice(offset, offset + 50);
      result.push(...(await this.ancestorBatch(batch, head)));
    }
    return result;
  }
  private async ancestorBatch(
    ancestors: string[],
    head: { branch: string; sha: string },
  ): Promise<boolean[]> {
    const fields = ancestors
      .map(
        (_, i) =>
          `a${i}: compare(headRef: $a${i}) { status baseTarget { oid } headTarget { oid } }`,
      )
      .join("\n");
    const response = await this.http.json<{
      errors?: unknown[];
      data?: {
        repository: {
          ref: Record<
            string,
            { status: string; baseTarget: { oid: string }; headTarget: { oid: string } } | null
          > | null;
        } | null;
      };
    }>("/graphql", {
      method: "POST",
      body: JSON.stringify({
        query: `query($owner: String!, $repo: String!, $branch: String!, ${ancestors.map((_, i) => `$a${i}: String!`).join(", ")}) { repository(owner: $owner, name: $repo) { ref(qualifiedName: $branch) { ${fields} } } }`,
        variables: {
          owner: this.owner,
          repo: this.repository,
          branch: `refs/heads/${head.branch}`,
          ...Object.fromEntries(ancestors.map((sha, i) => [`a${i}`, sha])),
        },
      }),
    });
    if (response.errors?.length || !response.data?.repository)
      throw new ForgeError("GitHub ancestry batch failed", 502, this.repoPath);
    const results: boolean[] = [];
    // Ref.compare has a mutable base. Trust only the comparison's exact immutable objects.
    // A moving/deleted ref falls back to REST at the originally selected SHAs.
    for (let i = 0; i < ancestors.length; i++) {
      const comparison = response.data.repository.ref?.[`a${i}`];
      if (response.data.repository.ref && comparison === undefined)
        throw new ForgeError("Incomplete GitHub ancestry response", 502, this.repoPath);
      const exact =
        comparison?.baseTarget.oid === head.sha && comparison.headTarget.oid === ancestors[i];
      results.push(
        exact
          ? comparison.status === "BEHIND" || comparison.status === "IDENTICAL"
          : await this.isAncestor(ancestors[i]!, head.sha),
      );
    }
    return results;
  }

  async mergeBranch(base: string, headSha: string): Promise<CommitResult> {
    if (!/^[a-f0-9]{40}$/i.test(headSha)) {
      throw new ForgeError("Publication requires a full immutable commit SHA", 422, this.repoPath);
    }
    const response = await this.http.request(`${this.repoPath}/merges`, {
      method: "POST",
      body: JSON.stringify({ base, head: headSha }),
    });
    if (response.status === 204) return { sha: await this.getBranchSha(base) };
    if (response.status === 404) {
      await response.body?.cancel();
      throw new ForgeError("Publication base or commit was not found", 404, this.repoPath);
    }
    const commit = (await response.json()) as { sha: string; html_url?: string };
    return { sha: commit.sha, ...(commit.html_url ? { url: commit.html_url } : {}) };
  }

  async commitFiles(options: CommitFilesOptions): Promise<CommitResult> {
    const headSha = await this.getBranchSha(options.branch);
    if (options.expectedHeadSha && options.expectedHeadSha !== headSha) {
      throw new ConflictError(options.branch, options.expectedHeadSha, headSha);
    }

    const headCommit = await this.http.json<{ tree: { sha: string } }>(
      `${this.repoPath}/git/commits/${headSha}`,
    );
    const tree = await this.http.json<{ sha: string }>(`${this.repoPath}/git/trees`, {
      method: "POST",
      body: JSON.stringify({
        base_tree: headCommit.tree.sha,
        tree: options.files.map((file) => ({
          path: file.path,
          mode: "100644",
          type: "blob",
          ...(file.content === null ? { sha: null } : { content: file.content }),
        })),
      }),
    });
    const commit = await this.http.json<{ sha: string; html_url?: string }>(
      `${this.repoPath}/git/commits`,
      {
        method: "POST",
        body: JSON.stringify({
          message: options.message,
          tree: tree.sha,
          parents: [headSha],
          ...(options.author ? { author: options.author } : {}),
          ...(options.committer ? { committer: options.committer } : {}),
        }),
      },
    );
    try {
      await this.http.json(`${this.repoPath}/git/refs/heads/${encodePath(options.branch)}`, {
        method: "PATCH",
        body: JSON.stringify({ sha: commit.sha, force: false }),
      });
    } catch (error) {
      // Another writer may advance the branch after the initial revision check.
      // Never force over their commit; translate a rejected fast-forward into the
      // same recoverable stale-revision error used before building the commit.
      if (error instanceof ForgeError && (error.status === 409 || error.status === 422)) {
        const actualSha = await this.getBranchSha(options.branch);
        if (actualSha !== headSha) throw new ConflictError(options.branch, headSha, actualSha);
      }
      throw error;
    }
    return { sha: commit.sha, ...(commit.html_url ? { url: commit.html_url } : {}) };
  }

  async createBranch(name: string, fromSha: string): Promise<void> {
    await this.http.json(`${this.repoPath}/git/refs`, {
      method: "POST",
      body: JSON.stringify({ ref: `refs/heads/${name}`, sha: fromSha }),
    });
  }
}

function encodePath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}
