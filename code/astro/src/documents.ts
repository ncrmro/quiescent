import {
  createDocumentHandler,
  type DocumentCacheStatus,
  type DocumentHandlerOptions,
  type DocumentRecord,
  type Frontmatter,
} from "@quiescent/server/documents";
/** Astro's public cache contract, structural so other server consumers do not need Astro. */
export interface RouteCache {
  readonly enabled: boolean;
  set(options: { maxAge?: number; swr?: number; tags?: string[] } | false): void;
  invalidate(options: { path?: string; tags?: string[] }): Promise<void>;
}

export type CacheFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<{
  status: number;
  headers: { get(name: string): string | null };
  arrayBuffer(): Promise<ArrayBuffer>;
}>;

export interface DocumentCacheOptions<T> {
  collection: string;
  origin: string;
  documentPath: (document: T) => string;
  indexPaths?: string[];
  affectedPaths?: (previous: T | null, next: T | null) => string[];
  maxAge?: number;
  fetch?: CacheFetch;
  /** Compatibility hook for existing route/media cache tags. */
  documentTag?: (id: string) => string;
}
export function documentCachePolicy(
  options: Pick<DocumentCacheOptions<unknown>, "collection" | "maxAge" | "documentTag">,
  id?: string,
) {
  const indexTag = `quiescent:${options.collection}`;
  const tag = options.documentTag ?? ((value: string) => `${indexTag}:${value}`);
  return {
    maxAge: options.maxAge ?? 86400,
    tags: [
      id ? tag(id) : indexTag,
      `quiescent:collection:${options.collection}`,
      "quiescent:public",
    ],
  };
}
/** Whole-page Astro caching, invalidation and eager warming for any collection. */
export function astroDocumentCache<T extends { id: string }>(options: DocumentCacheOptions<T>) {
  const send = options.fetch ?? fetch;
  const indexTag = `quiescent:${options.collection}`;
  const collectionTag = `quiescent:collection:${options.collection}`;
  const documentTag = options.documentTag ?? ((id: string) => `${indexTag}:${id}`);
  const indexes = options.indexPaths ?? [];
  async function warm(paths: string[], deletedPaths: string[] = []) {
    const unique = [...new Set(paths)];
    const fill = async (path: string) => {
      const response = await send(new URL(path, options.origin), { redirect: "manual" });
      await response.arrayBuffer();
      if (response.status !== (deletedPaths.includes(path) ? 404 : 200))
        throw new Error(`Page warming failed for ${path} (${response.status})`);
      return response.headers.get("x-astro-cache") ?? response.headers.get("cf-cache-status");
    };
    for (const path of unique) await retryWarm(() => fill(path));
    // A completed render need not mean its CDN cache fill has settled. Confirm
    // the entries after the whole batch, while the writer still owns the wait.
    for (const path of unique) await confirmCached(() => retryWarm(() => fill(path)));
  }

  function targets(document: T, deleted: boolean, previous: T | null) {
    const path = options.documentPath(document);
    const oldPath = previous ? options.documentPath(previous) : undefined;
    const removed = oldPath && oldPath !== path ? oldPath : undefined;
    const affected = options.affectedPaths?.(previous, deleted ? null : document) ?? [];
    return { path, removed, affected };
  }
  function addRefreshPaths(
    old: T | null,
    current: T | null,
    nextPaths: Set<string>,
    paths: Set<string>,
    removed: Set<string>,
  ) {
    if (old) {
      const path = options.documentPath(old);
      paths.add(path);
      if (!nextPaths.has(path)) removed.add(path);
    }
    if (current) paths.add(options.documentPath(current));
    for (const path of options.affectedPaths?.(old, current) ?? []) paths.add(path);
  }
  return {
    set(cache: RouteCache, id?: string, freshness?: DocumentCacheStatus) {
      if (freshness?.stale || freshness?.error) {
        cache.set(false);
        return;
      }
      const policy = documentCachePolicy(options, id);
      if (freshness?.fetchedAt)
        policy.maxAge = Math.max(
          1,
          Math.min(
            policy.maxAge,
            Math.floor((freshness.fetchedAt + (options.maxAge ?? 3600) * 1000 - Date.now()) / 1000),
          ),
        );
      cache.set(policy);
    },
    async afterPublication(
      cache: RouteCache,
      document: T,
      deleted: boolean,
      previous: T | null = null,
    ) {
      if (!cache.enabled) return;
      await cache.invalidate({ tags: [indexTag, documentTag(document.id)] });
      const { path, removed, affected } = targets(document, deleted, previous);
      for (const affectedPath of [...affected, ...(removed ? [removed] : [])])
        await cache.invalidate({ path: affectedPath });
      await warm([...indexes, ...affected, path], deleted ? [path] : []);
      if (removed) await warm([removed], [removed]);
    },
    /** Reconcile external Git changes after the document cache commits its new snapshot. */
    async afterRefresh(cache: RouteCache, previous: T[], next: T[], retry = false) {
      if (!cache.enabled) return;
      const before = new Map(previous.map((document) => [document.id, document]));
      const after = new Map(next.map((document) => [document.id, document]));
      const changed = [...new Set([...before.keys(), ...after.keys()])].filter(
        (id) => retry || JSON.stringify(before.get(id)) !== JSON.stringify(after.get(id)),
      );
      if (!changed.length && !retry) return;
      const paths = new Set(indexes);
      const nextPaths = new Set(next.map(options.documentPath));
      const removed = new Set<string>();
      for (const id of changed) {
        const old = before.get(id) ?? null;
        const current = after.get(id) ?? null;
        addRefreshPaths(old, current, nextPaths, paths, removed);
      }
      await cache.invalidate({ tags: [collectionTag] });
      for (const path of paths) await cache.invalidate({ path });
      await warm([...paths], [...removed]);
    },
    async refresh(cache: RouteCache, documents: T[]) {
      if (!cache.enabled)
        return { refreshed: false, reason: "Caching is disabled in development." };
      await cache.invalidate({ tags: [collectionTag] });
      await warm([...indexes, ...documents.map(options.documentPath)]);
      return {
        refreshed: true,
        pages: new Set([...indexes, ...documents.map(options.documentPath)]).size,
      };
    },
  };
}
/** A collection's private API and public page cache share one configuration. */
export function astroDocuments<T extends Frontmatter>(
  options: Omit<DocumentHandlerOptions<T>, "afterPublication"> &
    DocumentCacheOptions<DocumentRecord<T>>,
) {
  if (options.collection !== options.store.collection)
    throw new Error("Cache collection must match the document store");
  const pages = astroDocumentCache(options);
  return {
    ...pages,
    api: async ({ request, cache }: { request: Request; cache: RouteCache }) => {
      if (
        new URL(request.url).pathname === `${options.apiBase ?? "/api/documents"}/cache/refresh`
      ) {
        if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
        if (!(await options.authorize(request)) || request.headers.get("Origin") !== options.origin)
          return new Response("Unauthorized", { status: 403 });
        return Response.json(
          await pages.refresh(
            cache,
            (await options.store.listPublished()).map((draft) => draft.document),
          ),
        );
      }
      return createDocumentHandler({
        ...options,
        afterPublication: (document, deleted, previous) =>
          pages.afterPublication(cache, document, deleted, previous),
      })(request);
    },
  };
}

async function confirmCached(fill: () => Promise<string | null>) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const state = await fill();
    if (!state || state === "HIT") return;
    await new Promise((resolve) => setTimeout(resolve, 100 * 2 ** attempt));
  }
  throw new Error("Page cache did not retain the warmed response");
}

async function retryWarm<T>(fill: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fill();
    } catch (error) {
      if (attempt === 3) throw error;
      await new Promise((resolve) => setTimeout(resolve, 100 * 2 ** attempt));
    }
  }
}
