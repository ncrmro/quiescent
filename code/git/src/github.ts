import { decodeBase64 } from "./base64.ts";
import { ConflictError, ForgeError } from "./errors.ts";
import { createHttpClient, type HttpClient } from "./http.ts";
import type {
  CommitFilesOptions,
  CommitResult,
  CreatePullRequestOptions,
  FileContent,
  ForgeClient,
  ForgeConfig,
  ForgeUser,
  PullRequest,
  RepoEntry,
  RepoPermissions,
} from "./types.ts";

interface GitHubContentsEntry {
  path: string;
  name: string;
  type: "file" | "dir" | "symlink" | "submodule";
  sha: string;
  size: number;
  content?: string;
}

export class GitHubForge implements ForgeClient {
  readonly kind = "github" as const;
  private readonly http: HttpClient;
  private readonly repoPath: string;

  constructor(private readonly config: ForgeConfig) {
    this.http = createHttpClient({
      apiBase: "https://api.github.com",
      token: config.token,
      headers: {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      fetch: config.fetch,
    });
    this.repoPath = `/repos/${config.owner}/${config.repo}`;
  }

  async getUser(): Promise<ForgeUser> {
    const user = await this.http.json<{
      id: number;
      login: string;
      name?: string;
      email?: string;
      avatar_url?: string;
    }>("/user");
    return {
      id: user.id,
      login: user.login,
      name: user.name ?? undefined,
      email: user.email ?? undefined,
      avatarUrl: user.avatar_url,
    };
  }

  async getRepoPermissions(): Promise<RepoPermissions> {
    const repo = await this.http.json<{
      permissions?: { push?: boolean; admin?: boolean };
    }>(this.repoPath);
    return {
      push: repo.permissions?.push ?? false,
      admin: repo.permissions?.admin ?? false,
    };
  }

  async getFile(path: string, ref?: string): Promise<FileContent | null> {
    const query = ref ? `?ref=${encodeURIComponent(ref)}` : "";
    const response = await this.http.request(
      `${this.repoPath}/contents/${encodePath(path)}${query}`,
    );
    if (response.status === 404) return null;
    const entry = (await response.json()) as GitHubContentsEntry;
    if (entry.type !== "file" || entry.content === undefined) {
      throw new ForgeError(`${path} is not a file`, 422, path);
    }
    return { path: entry.path, sha: entry.sha, content: decodeBase64(entry.content) };
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
          content: file.content,
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
        }),
      },
    );
    await this.http.json(`${this.repoPath}/git/refs/heads/${encodePath(options.branch)}`, {
      method: "PATCH",
      body: JSON.stringify({ sha: commit.sha }),
    });
    return { sha: commit.sha, url: commit.html_url };
  }

  async createBranch(name: string, fromSha: string): Promise<void> {
    await this.http.json(`${this.repoPath}/git/refs`, {
      method: "POST",
      body: JSON.stringify({ ref: `refs/heads/${name}`, sha: fromSha }),
    });
  }

  async createPullRequest(options: CreatePullRequestOptions): Promise<PullRequest> {
    const pull = await this.http.json<{ number: number; html_url: string }>(
      `${this.repoPath}/pulls`,
      {
        method: "POST",
        body: JSON.stringify({
          title: options.title,
          head: options.head,
          base: options.base,
          body: options.body ?? "",
        }),
      },
    );
    return { number: pull.number, url: pull.html_url };
  }

  async ensureFork(): Promise<{ owner: string; repo: string }> {
    const fork = await this.http.json<{ name: string; owner: { login: string } }>(
      `${this.repoPath}/forks`,
      { method: "POST", body: JSON.stringify({}) },
    );
    return { owner: fork.owner.login, repo: fork.name };
  }
}

function encodePath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}
