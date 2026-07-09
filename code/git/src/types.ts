export type ForgeKind = "github" | "gitea" | "forgejo" | "codeberg";

export interface ForgeConfig {
  kind: ForgeKind;
  /** Required for gitea/forgejo; defaults to https://github.com / https://codeberg.org. */
  baseUrl?: string;
  owner: string;
  repo: string;
  token: string;
  /** Injectable for tests. */
  fetch?: typeof fetch;
}

export interface ForgeUser {
  id: number;
  login: string;
  name?: string;
  email?: string;
  avatarUrl?: string;
}

export interface RepoPermissions {
  push: boolean;
  admin: boolean;
}

export interface RepoEntry {
  path: string;
  name: string;
  type: "file" | "dir";
  sha: string;
  size?: number;
}

export interface FileContent {
  path: string;
  sha: string;
  content: string;
}

export interface CommitFileChange {
  path: string;
  content: string;
}

export interface CommitFilesOptions {
  branch: string;
  message: string;
  files: CommitFileChange[];
  /**
   * If set, the commit is rejected when the branch head no longer matches —
   * the caller's drafts were based on a stale ref.
   */
  expectedHeadSha?: string;
}

export interface CommitResult {
  sha: string;
  url?: string;
}

export interface CreatePullRequestOptions {
  /** Branch name; for cross-repo PRs on GitHub use "owner:branch". */
  head: string;
  base: string;
  title: string;
  body?: string;
}

export interface PullRequest {
  number: number;
  url: string;
}

export interface ForgeClient {
  readonly kind: ForgeKind;
  getUser(): Promise<ForgeUser>;
  getRepoPermissions(): Promise<RepoPermissions>;
  getFile(path: string, ref?: string): Promise<FileContent | null>;
  listDir(path?: string, ref?: string): Promise<RepoEntry[]>;
  getBranchSha(branch: string): Promise<string>;
  commitFiles(options: CommitFilesOptions): Promise<CommitResult>;
  createBranch(name: string, fromSha: string): Promise<void>;
  /** Force-moves an existing branch head to the given sha. */
  resetBranch(name: string, sha: string): Promise<void>;
  createPullRequest(options: CreatePullRequestOptions): Promise<PullRequest>;
  /**
   * Finds the open pull request from the given head (same "branch" or
   * "owner:branch" convention as CreatePullRequestOptions) into base, or null.
   */
  findOpenPullRequest(head: string, base: string): Promise<PullRequest | null>;
  /** Fork the repo for contributors without push access. Returns the fork's owner/repo. */
  ensureFork(): Promise<{ owner: string; repo: string }>;
}
