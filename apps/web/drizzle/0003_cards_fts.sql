-- FTS5 external-content table over cards (name, type_line, oracle_text).
-- Hand-written: drizzle-kit only diffs sqliteTable() declarations in
-- schema.ts and has no representation for SQLite virtual tables, so this
-- can't be generated. content_rowid='rowid' points at cards' implicit
-- rowid (its primary key is a non-integer ScryfallId, not a rowid alias) -
-- safe because the index is always fully rebuilt after a sync (see
-- server/search/fts.ts), never incrementally trigger-synced, so drift in
-- rowid assignment (e.g. across a VACUUM) self-heals on the next sync.
CREATE VIRTUAL TABLE IF NOT EXISTS cards_fts USING fts5(
  name,
  type_line,
  oracle_text,
  content='cards',
  content_rowid='rowid'
);
