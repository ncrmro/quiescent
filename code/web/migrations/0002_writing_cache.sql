CREATE TABLE writing_cache (
  cache_key TEXT PRIMARY KEY,
  generation INTEGER NOT NULL DEFAULT 0,
  value TEXT
);
