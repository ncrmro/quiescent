# Cached document listings

GitHub is authoritative for documents and workflow state; Git LFS is authoritative
for image originals. A listing cache is disposable. It must never acknowledge a
save before the Git write succeeds, and deleting the cache must not delete content.

`@quiescent/git` owns optimized GraphQL directory/blob reads and batched comparisons.
`@quiescent/server` owns the portable listing cache, freshness information, mutation
updates, rebuild coordination, and optional D1 adapter. `@quiescent/astro` continues
to own public HTML caching and eager page warming. Cache labels, search controls,
ordering, artwork and authentication belong to the application.

## Configure once per collection

Pass `cache: { storage, key, ttlMs, waitUntil }` to `createDocumentService`.
Scope `key` by provider, repository owner/name, publication branch, collection,
and schema/configuration version. Never reuse a private cache across repositories
or authorization boundaries. The example derives it from its JSON configuration.
`main` is the default publication branch; no deployment branch discovery is needed.

Cloudflare uses `d1DocumentCache(env.WRITING_CACHE)`, initialized with the exported
`@quiescent/server/documents-cache.schema.sql` file. Runtime `waitUntil` keeps
refresh work alive after a stale response. The Node example uses one bounded
`memoryDocumentCache()` instance per process and schedules background promises.
Hosts can implement `DocumentCacheStorage` for another backend; core service code
has no Cloudflare imports. D1 uses per-document rows and transactional metadata.

## Read and write behavior

- First read builds the complete listing from Git and stores it.
- Fresh reads use the cache without GitHub requests, including draft status.
- After the example's one-hour TTL, a visit returns the previous listing and starts
  a background rebuild. TTL is checked on reads; it is not a scheduled job.
- Successful create, edit, publish, and delete operations update the projection
  before returning. Opening an existing post's editing cycle updates draft state too.
- A rebuild cannot overwrite a newer web mutation. Concurrent or interrupted work
  is fenced, and uncertain state is rebuilt from Git.
- Git writes remain successful when a cache update fails; callers receive a
  separate `cacheWarning`. Refresh failures retain the previous listing and expose
  a safe error status. Out-of-band Git edits appear on refresh or TTL expiry.

`listDocuments()` remains array-compatible. `listDocumentsWithStatus()` returns
`{ documents, cache }`, including `fetchedAt`, `updatedAt`, `stale`, `refreshing`,
and optional `error`. `refreshDocuments()` explicitly rebuilds from Git.
The private handler exposes `GET /api/documents/<collection>/listing` and
same-origin `POST /api/documents/<collection>/listing/refresh`. Both require the
host's authorization callback; private responses remain no-store in the browser.

The example lists posts and recipes, filters title/description/tags/body locally,
and shows last GitHub fetch, cache update time, refresh status, and a refresh button.
Search does not call GitHub or D1 for each keystroke. Public pages keep reading only
published content; the draft listing cache is never a public page data source.

## Evidence

Against the 73-document website snapshot, the optimized cold listing made nine
GitHub requests versus the previous 41, with identical documents, states and
head SHAs. The measured comparison was about 2.3 versus 6.4 seconds; latency varies.
Warm-cache tests separately require zero Git calls. Cold rebuild speed and cached
read speed are distinct measurements.
