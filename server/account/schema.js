const ACCOUNT_SCHEMA_VERSION = 1;

function ensureAccountSchema(db, now = new Date().toISOString()) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS account_schema_meta (
      singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
      version INTEGER NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS account_tombstones (
      user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      deleted_at TEXT NOT NULL
    );
  `);
  db.prepare(`
    INSERT INTO account_schema_meta(singleton, version, updated_at) VALUES(1, ?, ?)
    ON CONFLICT(singleton) DO UPDATE SET version=excluded.version, updated_at=excluded.updated_at
  `).run(ACCOUNT_SCHEMA_VERSION, now);
  return { version: ACCOUNT_SCHEMA_VERSION };
}

module.exports = { ACCOUNT_SCHEMA_VERSION, ensureAccountSchema };
