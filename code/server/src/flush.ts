import {
  createForge,
  ForgeError,
  type CommitFileChange,
  type CommitSignature,
  type ForgeClient,
} from "@quiescent/git";
import { resolveTokenSource, type TokenSource, type WikiUser } from "./auth.ts";
import { deleteDraft, listAllDrafts, type Draft } from "./drafts.ts";
import { forgeConfig, type Env } from "./env.ts";

/** Drafts untouched for this long are flushed by the cron trigger. */
export const CRON_FLUSH_AFTER_MS = 5 * 60 * 1000;

export interface FlushResult {
  mode: "commit" | "pull-request";
  url?: string;
  sha?: string;
  paths: string[];
}

export interface FlushOptions {
  env: Env;
  origin: string;
  user: WikiUser;
  drafts: Draft[];
  /** Required in forge-OAuth mode; unused with a service token. */
  sessionId?: string;
  /** Defaults from the environment (SERVICE_TOKEN vs forge sessions). */
  tokenSource?: TokenSource;
}

function commitMessage(files: CommitFileChange[], author?: CommitSignature): string {
  const paths = files.map((f) => f.path);
  const summary = paths.length === 1 ? paths[0] : `${paths.length} files`;
  const body = paths.map((p) => `- ${p}`).join("\n");
  // Trailer mirrors the author override for forges that ignore it.
  const trailer = author ? `\n\nCo-authored-by: ${author.name} <${author.email}>` : "";
  return `docs: update ${summary} via quiescent\n\n${body}${trailer}`;
}

function branchSlug(user: WikiUser): string {
  return (user.name || user.id).toLowerCase().replace(/[^a-z0-9._-]+/g, "-");
}

export async function flushDrafts(options: FlushOptions): Promise<FlushResult | null> {
  const { env, origin, user, drafts, sessionId } = options;
  if (drafts.length === 0) return null;

  const tokenSource = options.tokenSource ?? resolveTokenSource(env, origin);
  const identity = await tokenSource.getCommitIdentity(user, sessionId);
  const forge = createForge(forgeConfig(env, identity.token));
  const files: CommitFileChange[] = drafts.map((d) => ({ path: d.path, content: d.content }));
  const message = commitMessage(files, identity.author);

  let result: FlushResult;
  if (user.canPush) {
    const commit = await forge.commitFiles({
      branch: env.DEFAULT_BRANCH,
      message,
      files,
      author: identity.author,
    });
    result = { mode: "commit", url: commit.url, sha: commit.sha, paths: files.map((f) => f.path) };
  } else {
    result = await proposeViaPullRequest(env, forge, identity.token, user, identity.author, files, message);
  }

  await Promise.all(drafts.map((d) => deleteDraft(env, d.user.id, d.path)));
  return result;
}

async function proposeViaPullRequest(
  env: Env,
  forge: ForgeClient,
  token: string,
  user: WikiUser,
  author: CommitSignature | undefined,
  files: CommitFileChange[],
  message: string,
): Promise<FlushResult> {
  const branch = `quiescent/${branchSlug(user)}/${Date.now()}`;
  const title = `Suggested edits from ${user.name ?? user.id}`;
  const body = `Proposed via [quiescent](https://github.com/ncrmro/quiescent).\n\n${files
    .map((f) => `- \`${f.path}\``)
    .join("\n")}`;
  const baseSha = await forge.getBranchSha(env.DEFAULT_BRANCH);

  try {
    // Some repos allow contributors to push branches directly.
    await forge.createBranch(branch, baseSha);
    await forge.commitFiles({ branch, message, files, author });
    const pr = await forge.createPullRequest({ head: branch, base: env.DEFAULT_BRANCH, title, body });
    return { mode: "pull-request", url: pr.url, paths: files.map((f) => f.path) };
  } catch (error) {
    if (!(error instanceof ForgeError) || (error.status !== 403 && error.status !== 404)) {
      throw error;
    }
  }

  // No branch permission: fork, commit there, open a cross-repo PR.
  const fork = await forge.ensureFork();
  const forkForge = createForge({ ...forgeConfig(env, token), owner: fork.owner, repo: fork.repo });
  const forkBaseSha = await forkForge.getBranchSha(env.DEFAULT_BRANCH);
  await forkForge.createBranch(branch, forkBaseSha);
  await forkForge.commitFiles({ branch, message, files, author });
  const pr = await forge.createPullRequest({
    head: `${fork.owner}:${branch}`,
    base: env.DEFAULT_BRANCH,
    title,
    body,
  });
  return { mode: "pull-request", url: pr.url, paths: files.map((f) => f.path) };
}

/**
 * Cron entrypoint: flush drafts that have been idle past the threshold.
 * Grouped per user (and per session in forge-OAuth mode, where the stored
 * tokens do the committing). Failures leave the draft in place for the
 * user's next visit.
 */
export async function flushStaleDrafts(env: Env, now = Date.now()): Promise<void> {
  const all = await listAllDrafts(env);
  const stale = all.filter((d) => now - d.updatedAt >= CRON_FLUSH_AFTER_MS);

  const groups = new Map<string, Draft[]>();
  for (const draft of stale) {
    const key = `${draft.user.id} ${draft.sessionId ?? ""}`;
    const group = groups.get(key) ?? [];
    group.push(draft);
    groups.set(key, group);
  }

  for (const drafts of groups.values()) {
    const { user, sessionId } = drafts[0]!;
    try {
      await flushDrafts({
        env,
        // Refresh needs an OAuth config but not a real request origin.
        origin: "https://quiescent.invalid",
        user,
        sessionId,
        drafts,
      });
    } catch (error) {
      console.error(`quiescent: cron flush failed for user ${user.id}:`, error);
    }
  }
}
