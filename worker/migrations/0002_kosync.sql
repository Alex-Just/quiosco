-- KOReader progress sync (kosync), read-only from the app's point of view.
-- One row per KOReader document; the account itself lives in Worker secrets.
CREATE TABLE IF NOT EXISTS kosync_progress (
  document TEXT PRIMARY KEY,
  filename TEXT,
  title TEXT,
  authors TEXT,
  -- Opaque to the server: a CRe XPointer for EPUBs, a page number for PDFs.
  -- Stored as TEXT because coercing it would destroy EPUB positions.
  progress TEXT NOT NULL,
  percentage REAL NOT NULL,
  device TEXT NOT NULL,
  device_id TEXT,
  -- Unix seconds, server-generated. The KOReader client compares it directly
  -- with a device-local os.time(), so milliseconds would break sync.
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_kosync_progress_filename
  ON kosync_progress(filename);

CREATE INDEX IF NOT EXISTS idx_kosync_progress_title
  ON kosync_progress(title);
