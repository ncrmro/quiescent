-- Rebuildable projection only. Git remains authoritative.
CREATE TABLE IF NOT EXISTS quiescent_document_cache (
  cache_key TEXT PRIMARY KEY,
  revision INTEGER NOT NULL DEFAULT 0,
  initialized INTEGER NOT NULL DEFAULT 0,
  pending INTEGER NOT NULL DEFAULT 0,
  write_until INTEGER NOT NULL DEFAULT 0,
  retry_at INTEGER NOT NULL DEFAULT 0,
  lease TEXT,
  lease_until INTEGER NOT NULL DEFAULT 0,
  fetched_at INTEGER,
  updated_at INTEGER,
  error TEXT
);
CREATE TABLE IF NOT EXISTS quiescent_document_cache_entries (
  cache_key TEXT NOT NULL,
  document_id TEXT NOT NULL,
  branch TEXT NOT NULL,
  document_json TEXT NOT NULL,
  PRIMARY KEY (cache_key, document_id, branch),
  FOREIGN KEY (cache_key) REFERENCES quiescent_document_cache(cache_key) ON DELETE CASCADE
);
