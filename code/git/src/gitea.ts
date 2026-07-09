// Covers Gitea, Forgejo, and Codeberg (hosted Forgejo) — Forgejo keeps Gitea
// API compatibility, so one client serves all three.
import { decodeBase64, encodeBase64 } from "./base64.ts";
import { ConflictError, ForgeError } from "./errors.ts";
import { createHttpClient, type HttpClient } from "./http.ts";
import type {
  CommitFilesOptions,
  CommitResult,
  CreatePullRequestOptions,
  FileContent,
  ForgeClient,
  ForgeConfig,
  ForgeKind,
  ForgeUser,
  PullRequest,
  RepoEntry,
  RepoPermissions,
} from "./types.ts";

interface GiteaContentsEntry {
  path: string;
  name: string;
  type: "file" | "dir" | "symlink" | "submodule";
  sha: string;
  size: number;
  content?: string | null;
}

export class GiteaForge implements ForgeClient {
  readonly kind: ForgeKind;
  private readonly http: HttpClient;
  private readonly repoPath: string;

  constructor(private readonly config: ForgeConfig) {
    this.kind = config.kind;
    const baseUrl = resolveGiteaBaseUrl(config);
    this.http = createHttpClient({
      apiBase: `${baseUrl}/api/v1`,
      token: config.token,
      fetch: config.fetch,
    });
    this.repoPath = `/repos/${config.owner}/${config.repo}`;
  }

  async getUser(): Promise<ForgeUser> {
    const user = await this.http.json<{
      id: number;
      login: string;
      full_name?: string;
      email?: string;
      avatar_url?: string;
    }>("/user");
    return {
      id: user.id,
      login: user.login,
      name: user.full_name || undefined,
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
    const entry = (await response.json()) as GiteaContentsEntry;
    if (entry.type !== "file" || entry.content == null) {
      throw new ForgeError(`${path} is not a file`, 422, path);
    }
    return { path: entry.path, sha: entry.sha, content: decodeBase64(entry.content) };
  }

  async listDir(path = "", ref?: string): Promise<RepoEntry[]> {
    const query = ref ? `?ref=${encodeURIComponent(ref)}` : "";
    const entries = await this.http.json<GiteaContentsEntry[]>(
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
    const info = await this.http.json<{ commit: { id: string } }>(
      `${this.repoPath}/branches/${encodePath(branch)}`,
    );
    return info.commit.id;
  }

  async commitFiles(options: CommitFilesOptions): Promise<CommitResult> {
    const headSha = await this.getBranchSha(options.branch);
    if (options.expectedHeadSha && options.expectedHeadSha !== headSha) {
      throw new ConflictError(options.branch, options.expectedHeadSha, headSha);
    }

    // Gitea's batch contents endpoint needs the current blob sha for updates,
    // so look up each file first to decide create vs update.
    const operations = await Promise.all(
      options.files.map(async (file) => {
        const existing = await this.getFile(file.path, options.branch);
        return {
          operation: existing ? "update" : "create",
          path: file.path,
          content: encodeBase64(file.content),
          ...(existing ? { sha: existing.sha } : {}),
        };
      }),
    );

    const result = await this.http.json<{ commit: { sha: string; html_url?: string } }>(
      `${this.repoPath}/contents`,
      {
        method: "POST",
        body: JSON.stringify({
          branch: options.branch,
          message: options.message,
          files: operations,
        }),
      },
    );
    return { sha: result.commit.sha, url: result.commit.html_url };
  }

  async createBranch(name: string, fromSha: string): Promise<void> {
    await this.http.json(`${this.repoPath}/branches`, {
      method: "POST",
      body: JSON.stringify({ new_branch_name: name, old_ref_name: fromSha }),
    });
  }

  async resetBranch(name: string, sha: string): Promise<void> {
    // Gitea has no force-update-ref endpoint; recreate the branch at the sha.
    await this.http.request(`${this.repoPath}/branches/${encodePath(name)}`, {
      method: "DELETE",
    });
    await this.createBranch(name, sha);
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

  async findOpenPullRequest(head: string, base: string): Promise<PullRequest | null> {
    // Gitea's list endpoint has no head filter; match on the head label
    // ("owner:branch" for cross-repo heads, plain branch otherwise).
    const [headOwner, headBranch] = head.includes(":")
      ? (head.split(":", 2) as [string, string])
      : [this.config.owner, head];
    const pulls = await this.http.json<
      {
        number: number;
        html_url: string;
        base: { ref: string };
        head: { ref: string; repo?: { owner?: { login?: string } } };
      }[]
    >(`${this.repoPath}/pulls?state=open&limit=50`);
    const pull = pulls.find(
      (p) =>
        p.base.ref === base &&
        p.head.ref === headBranch &&
        (p.head.repo?.owner?.login ?? this.config.owner) === headOwner,
    );
    return pull ? { number: pull.number, url: pull.html_url } : null;
  }

  async ensureFork(): Promise<{ owner: string; repo: string }> {
    const fork = await this.http.json<{ name: string; owner: { login: string } }>(
      `${this.repoPath}/forks`,
      { method: "POST", body: JSON.stringify({}) },
    );
    return { owner: fork.owner.login, repo: fork.name };
  }
}

export function resolveGiteaBaseUrl(config: Pick<ForgeConfig, "kind" | "baseUrl">): string {
  if (config.baseUrl) return config.baseUrl.replace(/\/$/, "");
  if (config.kind === "codeberg") return "https://codeberg.org";
  throw new Error(`baseUrl is required for forge kind "${config.kind}"`);
}

function encodePath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}
