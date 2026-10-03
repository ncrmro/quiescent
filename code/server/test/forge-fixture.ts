import type { CommitFilesOptions, PublishingForge } from "@quiescent/git";
import { createDocumentStore } from "../src/document-store.ts";
export function fixture() {
  type Commit = { files: Record<string, string>; parents: string[] };
  const commits = new Map<string, Commit>([["root", { files: {}, parents: [] }]]);
  const branches = new Map([["main", "root"]]);
  let counter = 0;
  let loseMergeResponse = false;
  let losePrepareResponse = false;
  function resolve(ref: string) {
    return branches.get(ref) ?? ref;
  }
  function ancestor(a: string, b: string): boolean {
    return a === b || commits.get(b)!.parents.some((p) => ancestor(a, p));
  }
  function add(files: Record<string, string>, parents: string[]) {
    const sha = `commit-${++counter}`;
    commits.set(sha, { files, parents });
    return sha;
  }
  const forge: PublishingForge = {
    kind: "github",
    async getBranchSha(branch: string) {
      if (!branches.has(branch)) throw new Error("missing branch");
      return branches.get(branch)!;
    },
    async createBranch(name: string, sha: string) {
      if (branches.has(name)) throw new Error("branch exists");
      branches.set(name, sha);
    },
    async getFile(path: string, ref = "main") {
      const sha = resolve(ref);
      const content = commits.get(sha)!.files[path];
      return content === undefined ? null : { path, sha, content };
    },
    async listDir(path = "", ref = "main") {
      return [
        ...new Set(
          Object.keys(commits.get(resolve(ref))!.files)
            .filter((p) => p.startsWith(`${path}/`))
            .map((p) => p.slice(path.length + 1).split("/")[0]!),
        ),
      ].map((name) => ({ name, path: `${path}/${name}`, sha: ref, type: "dir" as const }));
    },
    async commitFiles(options: CommitFilesOptions) {
      const parent = branches.get(options.branch)!;
      if (parent !== options.expectedHeadSha) throw new Error("stale");
      const files = { ...commits.get(parent)!.files };
      for (const change of options.files) {
        if (change.content === null) delete files[change.path];
        else files[change.path] = change.content;
      }
      const sha = add(files, [parent]);
      branches.set(options.branch, sha);
      if (losePrepareResponse && options.message === "Prepare document publication") {
        losePrepareResponse = false;
        throw new Error("connection lost during prepare");
      }
      return { sha };
    },
    async listBranches(prefix: string) {
      return [...branches]
        .filter(([name]) => name.startsWith(prefix))
        .map(([name, sha]) => ({ name, sha }));
    },
    async isAncestor(a: string, b: string) {
      return ancestor(resolve(a), resolve(b));
    },
    async compareCommits(base: string, head: string) {
      function mergeBase(candidate: string): string | undefined {
        if (ancestor(candidate, base)) return candidate;
        for (const parent of commits.get(candidate)!.parents) {
          const found = mergeBase(parent);
          if (found) return found;
        }
        return undefined;
      }
      const common = mergeBase(head)!;
      const before = commits.get(common)!.files;
      const after = commits.get(head)!.files;
      return {
        status: "ahead",
        aheadBy: 1,
        files: [...new Set([...Object.keys(before), ...Object.keys(after)])]
          .filter((p) => before[p] !== after[p])
          .map((filename) => ({ filename })),
      };
    },
    async mergeBranch(base: string, head: string) {
      const parent = branches.get(base)!;
      const comparison = await forge.compareCommits(parent, head);
      const files = { ...commits.get(parent)!.files };
      for (const { filename } of comparison.files) {
        const value = commits.get(head)!.files[filename];
        if (value === undefined) delete files[filename];
        else files[filename] = value;
      }
      const sha = add(files, [parent, head]);
      branches.set(base, sha);
      if (loseMergeResponse) {
        loseMergeResponse = false;
        throw new Error("connection lost");
      }
      return { sha };
    },
  };
  return {
    forge,
    branches,
    commits,
    loseNextMergeResponse() {
      loseMergeResponse = true;
    },
    loseNextPrepareResponse() {
      losePrepareResponse = true;
    },
    service: () =>
      createDocumentStore<{ title: string; slug: string }>({
        collection: "posts",
        schema: true,
        forge,
        author: { name: "Writer", email: "writer@example.test" },
      }),
  };
}
