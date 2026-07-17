PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS docs_meta (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  description TEXT,
  date TEXT,
  type TEXT,
  layout TEXT,
  canonical_url TEXT,
  raw_mdx TEXT,
  ir_json TEXT,
  html_cache TEXT,
  gemtext_cache TEXT,
  gopher_cache TEXT,
  rss_cache TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  published_at TEXT,
  doc_order INTEGER,
  meta_json TEXT
);

CREATE VIRTUAL TABLE IF NOT EXISTS docs_fts USING fts5(
  title,
  description,
  raw_mdx,
  content='docs_meta',
  content_rowid='id'
);

CREATE TRIGGER IF NOT EXISTS docs_ai AFTER INSERT ON docs_meta BEGIN
  INSERT INTO docs_fts(rowid, title, description, raw_mdx)
  VALUES (new.id, new.title, new.description, new.raw_mdx);
END;

CREATE TRIGGER IF NOT EXISTS docs_ad AFTER DELETE ON docs_meta BEGIN
  INSERT INTO docs_fts(docs_fts, rowid, title, description, raw_mdx)
  VALUES ('delete', old.id, old.title, old.description, old.raw_mdx);
END;

CREATE TRIGGER IF NOT EXISTS docs_au AFTER UPDATE ON docs_meta BEGIN
  INSERT INTO docs_fts(docs_fts, rowid, title, description, raw_mdx)
  VALUES ('delete', old.id, old.title, old.description, old.raw_mdx);
  INSERT INTO docs_fts(rowid, title, description, raw_mdx)
  VALUES (new.id, new.title, new.description, new.raw_mdx);
END;

CREATE TABLE IF NOT EXISTS terms (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  taxonomy TEXT NOT NULL,
  slug TEXT NOT NULL,
  name TEXT NOT NULL,
  UNIQUE(taxonomy, slug)
);

CREATE TABLE IF NOT EXISTS term_relationships (
  doc_id INTEGER NOT NULL,
  term_id INTEGER NOT NULL,
  PRIMARY KEY (doc_id, term_id),
  FOREIGN KEY (doc_id) REFERENCES docs_meta(id) ON DELETE CASCADE,
  FOREIGN KEY (term_id) REFERENCES terms(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS syndication (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  doc_id INTEGER NOT NULL,
  platform TEXT NOT NULL,
  url TEXT NOT NULL,
  published_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (doc_id) REFERENCES docs_meta(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS oauth_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider TEXT NOT NULL,
  token TEXT NOT NULL,
  refresh_token TEXT,
  expires_at TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_docs_meta_slug ON docs_meta(slug);
CREATE INDEX IF NOT EXISTS idx_docs_meta_date ON docs_meta(date);
CREATE INDEX IF NOT EXISTS idx_terms_taxonomy ON terms(taxonomy, slug);
