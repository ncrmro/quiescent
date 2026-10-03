# Unified document cache

GitHub is authoritative for documents and workflow state; Git LFS is authoritative
for image originals. The document cache is disposable. It must never acknowledge a
save before the Git write succeeds, and deleting the cache must not delete content.

`@quiescent/git` owns optimized GraphQL directory/blob reads and batched comparisons.
`@quiescent/server` owns the portable document cache, freshness information, mutation
updates, rebuild coordination, and D1/SQLite adapters. `@quiescent/astro` continues
to own public HTML caching and eager page warming. Cache labels, search controls,
ordering, artwork and authentication belong to the application.

## Configure once per collection

Pass `cache: { storage, key, ttlMs, waitUntil }` to `createDocumentService`.
Scope `key` by provider, repository owner/name, publication branch, collection,
and schema/configuration version. Never reuse a private cache across repositories
or authorization boundaries. The example derives it from its JSON configuration.
`main` is the default publication branch; no deployment branch discovery is needed.

Cloudflare uses `d1DocumentCache(env.WRITING_CACHE)`. Install the base schema and
declared scalar indexes during setup. After building the server package,
`scripts/cache-schema.mjs` emits the base SQL plus
`documentCacheIndexStatements(indexes)` for the collections in the JSON configuration.
Pass an alternate configuration path as its first argument. The writing deployment
and local development scripts generate and apply this SQL before starting the Worker. Runtime `waitUntil` keeps
refresh work alive after a stale response. The Node example uses `sqliteDocumentCache({ url: "file:.writing-cache.sqlite" })`
from `@quiescent/server/sqlite-cache`. Pass the union of collection index declarations
as its `indexes` option. It initializes the schema and indexes once,
persists across restarts, and schedules background promises. Set `WRITING_CACHE_URL`
to choose the file. `@libsql/client` is an optional peer dependency of the server
package; SQLite consumers must install it explicitly. The Node example declares
it directly. Worker-only consumers do not need it.
Hosts can implement `DocumentCacheStorage` for another backend; core service code
has no Cloudflare imports. D1 and local SQLite use the same SQL schema and queries. One `quiescent_documents`
table holds all collections, with separate published and draft rows and scoped
freshness metadata. Public reads select only published rows.

## Read and write behavior

- A cold public read fills published rows from the publication branch only.
- Admin reads also fill draft rows; they overlay drafts on published documents.
- Public articles and editor loads query cached individual rows.
- Fresh reads use the cache without GitHub requests, including draft status.
- After the example's one-hour TTL, a visit returns the previous listing and starts
  a background rebuild. TTL is checked on reads; it is not a scheduled job.
- Successful create, edit, publish, and delete operations update the projection
  before returning. Opening an editor does not create a branch. The first save of a published
  document creates its draft cycle after checking the Git revision.
- A rebuild cannot overwrite a newer web mutation. Concurrent or interrupted work
  is fenced, and uncertain state is rebuilt from Git.
- Git writes remain successful when a cache update fails; callers receive a
  separate `cacheWarning`. Refresh failures retain the previous listing and expose
  a safe error status. Out-of-band Git edits appear on refresh or TTL expiry.

`listDocuments()` remains array-compatible. `listDocumentsWithStatus()` returns
`{ documents, cache }`, including fetch/update timestamps, expiry, `stale`, `refreshing`,
and optional `error`. `refreshDocuments()` explicitly rebuilds from Git.
The private handler exposes `GET /api/documents/<collection>/listing` and
same-origin `POST /api/documents/<collection>/listing/refresh`. Both require the
host's authorization callback; private responses remain no-store in the browser.

The example lists posts and recipes, filters title/description/tags/body locally,
and shows last GitHub fetch, cache update time, refresh status, and a refresh button.
Search does not call GitHub or D1 for each keystroke. Public pages and admin pages share the document table while selecting different
visibility. Public reads never include unpublished documents.

## Queries and HTML freshness

Declare scalar metadata indexes in each collection
(`"indexes": ["preparationMinutes"]`, for example). Setup skips fields already
covered by built-in ID, slug, and date columns/indexes. Declare additional fields
only when queries use them. Reads do not create indexes or execute schema DDL.
After changing declarations, rerun setup before serving the new configuration. Lists accept `where` predicates (`eq`, `lt`,
`lte`, `gt`, `gte`), `orderBy`, `limit`, and `offset`. ID and slug lookups use the
same cache. The recipe index demonstrates filtering preparation time in SQL.
Array/tag indexes, full-text search, per-collection tables, and remote SQLite
replication are outside this scope. Existing JSON Schema validation remains in use.

Astro still owns full-page HTML caching above this data cache. Publication and
delete invalidate and warm affected pages. An external published refresh calls
`onPublishedChange`; the example wires this to `pages.afterRefresh` to invalidate
and warm changed URLs. Stale data responses do not seed fresh HTML cache entries.
Fresh HTML lifetime is bounded by the data expiry supplied in cache status;
changing `ttlMs` does not require duplicating that duration in the HTML policy.

Apply the exported cache schema before deploying a new Worker. Remove obsolete
cache tables only after the old Worker has been replaced; cache migrations do not
modify Git documents or LFS assets.

SQL adapters store a SHA-256 digest of the repository/configuration scope instead
of repeating the full serialized schema in each row and index. Switching from the
old scope representation causes a cold refill; existing old-scope rows are not
automatically removed. After the new deployment is verified and rollback no longer
needs the old cache, remove obsolete scoped cache rows through the host's maintenance
workflow. Scope cleanup must never remove Git content or LFS originals.

## Evidence

Against the 73-document website snapshot, the optimized cold listing made nine
GitHub requests versus the previous 41, with identical documents, states and
head SHAs. The measured comparison was about 2.3 versus 6.4 seconds; latency varies.
Warm-cache tests separately require zero Git calls. Cold rebuild speed and cached
read speed are distinct measurements.
