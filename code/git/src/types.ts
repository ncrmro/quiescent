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
  /** null deletes an existing file in the same commit. */
  content: string | null;
}

export interface CommitSignature {
  name: string;
  email: string;
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
  /**
   * Override the commit author, e.g. attributing a service-token commit to
   * the human who made the edit. Defaults to the token's identity.
   */
  author?: CommitSignature;
  committer?: CommitSignature;
}

export interface CommitResult {
  sha: string;
  url?: string;
}

/** File/ref operations. Only PublishingForge supports the document lifecycle. */
export interface ForgeClient {
  readonly kind: ForgeKind;
  getFile(path: string, ref?: string): Promise<FileContent | null>;
  listDir(path?: string, ref?: string): Promise<RepoEntry[]>;
  getBranchSha(branch: string): Promise<string>;
  commitFiles(options: CommitFilesOptions): Promise<CommitResult>;
  createBranch(name: string, fromSha: string): Promise<void>;
}

/** Optional publishing capability; adapters must implement this explicitly. */
export interface PublishingForge extends ForgeClient {
  /** Read text files at immutable commits in input order; null denotes an absent file. */
  getFiles?(files: Array<{ path: string; ref: string }>): Promise<Array<FileContent | null>>;
  /** Complete immediate text-file contents at an immutable commit; an absent directory is empty. */
  getDirectoryFiles?(path: string, ref: string): Promise<FileContent[]>;
  /** Ordered immutable ancestry checks. The branch is only a hint; adapters must verify object IDs. */
  areAncestors?(ancestors: string[], head: { branch: string; sha: string }): Promise<boolean[]>;
  listBranches(prefix: string): Promise<Array<{ name: string; sha: string }>>;
  /** Complete file scope, including rename sources. Rejects potentially truncated results. */
  compareCommits(baseSha: string, headSha: string): Promise<CommitComparison>;
  /** Merge an immutable full commit SHA, never a mutable branch name. */
  mergeBranch(base: string, headSha: string): Promise<CommitResult>;
  isAncestor(ancestor: string, head: string): Promise<boolean>;
}

export interface CommitComparison {
  status: string;
  aheadBy: number;
  files: Array<{ filename: string; previousFilename?: string }>;
}
