import { encodeBase64 } from "@quiescent/git";

/**
 * An in-memory stand-in for a git forge's HTTP API, good enough for the
 * blog/wiki demos: it serves the GitHub endpoints @quiescent/git actually
 * calls (contents, branch ref, commit, tree, ref update) against a Map of
 * paths. Injected through `Env.fetch`, so the demo exercises the real
 * ForgeClient and the real flush-to-commit path without a network, a token,
 * or a repo.
 */

export interface DemoCommit {
  sha: string;
  message: string;
  paths: string[];
  at: number;
}

export interface DemoForge {
  fetch: typeof fetch;
  files: Map<string, string>;
  commits: DemoCommit[];
  reset(): void;
}

function sha(seed: number): string {
  return seed.toString(16).padStart(40, "0");
}

export function createDemoForge(seedFiles: Record<string, string>): DemoForge {
  const initial = new Map(Object.entries(seedFiles));
  const state = {
    files: new Map(initial),
    commits: [] as DemoCommit[],
    head: sha(1),
    counter: 1,
    // Tree contents staged by POST /git/trees, applied on the ref update.
    pendingTree: new Map<string, Array<{ path: string; content: string }>>(),
  };

  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), {
      status,
      headers: { "Content-Type": "application/json" },
    });

  const demoFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const method = init?.method ?? "GET";
    const path = new URL(url).pathname;
    const body = init?.body ? (JSON.parse(init.body as string) as Record<string, unknown>) : {};

    // GET /repos/:owner/:repo/contents/<path>
    const contents = path.match(/\/contents\/(.*)$/);
    if (method === "GET" && contents) {
      const target = decodeURIComponent(contents[1] ?? "");
      const file = state.files.get(target);
      if (file !== undefined) {
        return json({
          path: target,
          name: target.split("/").pop(),
          type: "file",
          sha: sha(target.length + file.length),
          size: file.length,
          content: encodeBase64(file),
        });
      }
      // Directory listing: immediate children of `target`.
      const prefix = target ? `${target.replace(/\/$/, "")}/` : "";
      const seen = new Map<string, { path: string; name: string; type: "file" | "dir" }>();
      for (const key of state.files.keys()) {
        if (!key.startsWith(prefix)) continue;
        const rest = key.slice(prefix.length);
        if (!rest) continue;
        const slash = rest.indexOf("/");
        const name = slash === -1 ? rest : rest.slice(0, slash);
        const entryPath = `${prefix}${name}`;
        if (!seen.has(entryPath)) {
          seen.set(entryPath, { path: entryPath, name, type: slash === -1 ? "file" : "dir" });
        }
      }
      if (seen.size === 0) return json({ message: "Not Found" }, 404);
      return json(
        [...seen.values()].map((entry) => ({ ...entry, sha: sha(entry.path.length), size: 0 })),
      );
    }

    // GET /git/ref/heads/<branch>
    if (method === "GET" && /\/git\/ref\/heads\//.test(path)) {
      return json({ object: { sha: state.head } });
    }
    // GET /git/commits/<sha> — only the base tree matters to the client.
    if (method === "GET" && /\/git\/commits\/[0-9a-f]+$/.test(path)) {
      return json({ tree: { sha: `tree-${state.head}` } });
    }
    // POST /git/trees — stage the new blobs.
    if (method === "POST" && path.endsWith("/git/trees")) {
      const treeSha = `tree-${sha(++state.counter)}`;
      const entries = (body.tree as Array<{ path: string; content: string }>) ?? [];
      state.pendingTree.set(treeSha, entries);
      return json({ sha: treeSha });
    }
    // POST /git/commits — record the commit and apply its tree.
    if (method === "POST" && path.endsWith("/git/commits")) {
      const commitSha = sha(++state.counter);
      const treeSha = body.tree as string;
      const entries = state.pendingTree.get(treeSha) ?? [];
      for (const entry of entries) state.files.set(entry.path, entry.content);
      state.pendingTree.delete(treeSha);
      state.commits.push({
        sha: commitSha,
        message: String(body.message ?? ""),
        paths: entries.map((e) => e.path),
        at: Date.now(),
      });
      return json({ sha: commitSha, html_url: `https://demo.invalid/commit/${commitSha}` });
    }
    // PATCH /git/refs/heads/<branch> — move the branch to the new commit.
    if (method === "PATCH" && /\/git\/refs\/heads\//.test(path)) {
      state.head = String(body.sha ?? state.head);
      return json({ object: { sha: state.head } });
    }

    return json({ message: `demo forge: unhandled ${method} ${path}` }, 404);
  }) as typeof fetch;

  return {
    fetch: demoFetch,
    get files() {
      return state.files;
    },
    get commits() {
      return state.commits;
    },
    reset() {
      state.files = new Map(initial);
      state.commits = [];
      state.head = sha(1);
      state.counter = 1;
      state.pendingTree.clear();
    },
  };
}
