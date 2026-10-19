CREATE TABLE market_data_cache (
  cache_key TEXT PRIMARY KEY NOT NULL,
  data TEXT,
  next_attempt_at INTEGER NOT NULL DEFAULT 0,
  lease_until INTEGER NOT NULL DEFAULT 0,
  lease_token TEXT,
  last_error TEXT
);
