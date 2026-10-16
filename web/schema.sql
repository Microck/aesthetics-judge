-- Public feed of judged tracks. Scores are computed in the visitor's browser,
-- so they are unverifiable; the feed Function only bounds them.
CREATE TABLE IF NOT EXISTS scans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  artist TEXT NOT NULL,
  album TEXT,
  year TEXT,
  cover_url TEXT,
  ce REAL NOT NULL,
  cu REAL NOT NULL,
  pc REAL NOT NULL,
  pq REAL NOT NULL,
  duration REAL NOT NULL,
  ip_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS scans_created ON scans (created_at DESC);
CREATE INDEX IF NOT EXISTS scans_ip ON scans (ip_hash, created_at);

-- Fixed-window counters for rate limits that must hold across every edge
-- isolate (per-IP and global). key = "<limit name>:<subject>:<window index>".
CREATE TABLE IF NOT EXISTS rate_limits (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

-- AcoustID answers, keyed by a hash of the fingerprint, so repeat lookups of
-- the same recording don't spend the shared 3 req/s key budget.
CREATE TABLE IF NOT EXISTS acoustid_cache (
  fingerprint_hash TEXT PRIMARY KEY,
  response TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);

-- Deezer search answers by normalized query. The edge Cache API is a no-op on
-- workers.dev, so the cache lives here.
CREATE TABLE IF NOT EXISTS catalog_cache (
  query TEXT PRIMARY KEY,
  response TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
