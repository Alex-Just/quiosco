CREATE TABLE IF NOT EXISTS articles (
  id TEXT PRIMARY KEY,
  updated_at INTEGER NOT NULL,
  server_seq INTEGER NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  data TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_articles_server_seq ON articles(server_seq);

CREATE TABLE IF NOT EXISTS settings (
  id TEXT PRIMARY KEY,
  updated_at INTEGER NOT NULL,
  server_seq INTEGER NOT NULL,
  data TEXT NOT NULL
);
