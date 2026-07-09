import {
  createForge,
  ForgeError,
  type CommitFileChange,
  type ForgeClient,
} from "@quiescent/git";
import { deleteDraft, listAllDrafts, type Draft } from "./drafts.ts";
import { forgeConfig, type Env } from "./env.ts";
import { getSessionById, getValidAccessToken, type Session } from "./session.ts";

/** Drafts untouched for this long are flushed by the cron trigger. */
export const CRON_FLUSH_AFTER_MS = 5 * 60 * 1000;

export interface FlushResult {
  mode: "commit" | "pull-request";
  url?: string;
  sha?: string;
  paths: string[];
}

function commitMessage(files: CommitFileChange[]): string {
  const paths = files.map((f) => f.path);
  const summary = paths.length === 1 ? paths[0] : `${paths.length} files`;
  return `docs: update ${summary} via quiescent\n\n${paths.map((p) => `- ${p}`).join("\n")}`;
}

export async function flushDrafts(options: {
  env: Env;
  origin: string;
  sessionId: string;
  session: Session;
  drafts: Draft[];
}): Promise<FlushResult | null> {
  const { env, origin, sessionId, session, drafts } = options;
  if (drafts.length === 0) return null;

  const token = await getValidAccessToken(env, origin, sessionId, session);
  const forge = createForge(forgeConfig(env, token));
  const files: CommitFileChange[] = drafts.map((d) => ({ path: d.path, content: d.content }));
  const message = commitMessage(files);

  let result: FlushResult;
  if (session.canPush && env.FLUSH_MODE !== "pull-request") {
    const commit = await forge.commitFiles({
      branch: env.DEFAULT_BRANCH,
      message,
      files,
    });
    result = { mode: "commit", url: commit.url, sha: commit.sha, paths: files.map((f) => f.path) };
  } else {
    result = await proposeViaPullRequest(env, forge, token, session, files, message);
  }

  await Promise.all(drafts.map((d) => deleteDraft(env, d.userId, d.path)));
  return result;
}

async function proposeViaPullRequest(
  env: Env,
  forge: ForgeClient,
  token: string,
  session: Session,
  files: CommitFileChange[],
  message: string,
): Promise<FlushResult> {
  // One stable branch per user: repeated flushes stack commits onto the same
  // open pull request instead of spawning a branch + PR (and a CI run per PR)
  // every time.
  const branch = `quiescent/${session.login}`;
  const title = `Suggested edits from ${session.login}`;
  const body = `Proposed via [quiescent](https://github.com/ncrmro/quiescent).\n\n${files
    .map((f) => `- \`${f.path}\``)
    .join("\n")}`;

  try {
    // Some repos allow contributors to push branches directly.
    return await flushToBranchPullRequest({
      env,
      prForge: forge,
      commitForge: forge,
      head: branch,
      branch,
      files,
      message,
      title,
      body,
    });
  } catch (error) {
    if (!(error instanceof ForgeError) || (error.status !== 403 && error.status !== 404)) {
      throw error;
    }
  }

  // No branch permission: fork, commit there, open a cross-repo PR.
  const fork = await forge.ensureFork();
  const forkForge = createForge({ ...forgeConfig(env, token), owner: fork.owner, repo: fork.repo });
  return flushToBranchPullRequest({
    env,
    prForge: forge,
    commitForge: forkForge,
    head: `${fork.owner}:${branch}`,
    branch,
    files,
    message,
    title,
    body,
  });
}

/**
 * Commits onto the user's quiescent branch, reusing the open pull request for
 * it when one exists; otherwise points the branch at the current base head
 * (creating or resetting it) and opens a fresh pull request.
 */
async function flushToBranchPullRequest(options: {
  env: Env;
  /** Upstream repo: where pull requests live. */
  prForge: ForgeClient;
  /** Where the branch and commits go — upstream, or the user's fork. */
  commitForge: ForgeClient;
  head: string;
  branch: string;
  files: CommitFileChange[];
  message: string;
  title: string;
  body: string;
}): Promise<FlushResult> {
  const { env, prForge, commitForge, head, branch, files, message, title, body } = options;
  const paths = files.map((f) => f.path);

  const existing = await prForge.findOpenPullRequest(head, env.DEFAULT_BRANCH);
  if (existing) {
    await commitForge.commitFiles({ branch, message, files });
    return { mode: "pull-request", url: existing.url, paths };
  }

  // No open PR: any commits left on the branch belong to a merged or closed
  // PR, so (re)point it at the base head before committing.
  const baseSha = await commitForge.getBranchSha(env.DEFAULT_BRANCH);
  let branchSha: string | null;
  try {
    branchSha = await commitForge.getBranchSha(branch);
  } catch (error) {
    if (error instanceof ForgeError && error.status === 404) branchSha = null;
    else throw error;
  }
  if (branchSha === null) await commitForge.createBranch(branch, baseSha);
  else if (branchSha !== baseSha) await commitForge.resetBranch(branch, baseSha);

  await commitForge.commitFiles({ branch, message, files });
  const pr = await prForge.createPullRequest({ head, base: env.DEFAULT_BRANCH, title, body });
  return { mode: "pull-request", url: pr.url, paths };
}

/**
 * Cron entrypoint: flush drafts that have been idle past the threshold, using
 * the tokens stored on the session that produced them. Failures leave the
 * draft in place for the user's next visit.
 */
export async function flushStaleDrafts(env: Env, now = Date.now()): Promise<void> {
  const all = await listAllDrafts(env);
  const stale = all.filter((d) => now - d.updatedAt >= CRON_FLUSH_AFTER_MS);

  const bySession = new Map<string, Draft[]>();
  for (const draft of stale) {
    const group = bySession.get(draft.sessionId) ?? [];
    group.push(draft);
    bySession.set(draft.sessionId, group);
  }

  for (const [sessionId, drafts] of bySession) {
    try {
      const session = await getSessionById(env, sessionId);
      if (!session) continue;
      await flushDrafts({
        env,
        // Refresh needs an OAuth config but not a real request origin.
        origin: "https://quiescent.invalid",
        sessionId,
        session,
        drafts,
      });
    } catch (error) {
      console.error(`quiescent: cron flush failed for session ${sessionId}:`, error);
    }
  }
}
