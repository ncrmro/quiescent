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
CREATE TABLE IF NOT EXISTS quiescent_documents (
  scope TEXT NOT NULL,
  collection TEXT NOT NULL,
  document_id TEXT NOT NULL,
  branch TEXT NOT NULL,
  slug TEXT,
  frontmatter_json TEXT NOT NULL,
  body TEXT NOT NULL,
  revision TEXT NOT NULL,
  created_at TEXT NOT NULL,
  published_at TEXT,
  directory TEXT,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY(scope, collection, document_id, branch)
);
CREATE INDEX IF NOT EXISTS quiescent_documents_slug ON quiescent_documents(scope, collection, slug, branch);
CREATE INDEX IF NOT EXISTS quiescent_documents_created ON quiescent_documents(scope, collection, created_at, branch);
CREATE INDEX IF NOT EXISTS quiescent_documents_published ON quiescent_documents(scope, collection, published_at, branch);
