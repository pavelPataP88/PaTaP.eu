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

    CREATE TRIGGER IF NOT EXISTS account_tombstone_profile_after_insert
    AFTER INSERT ON account_tombstones
    BEGIN
      INSERT OR REPLACE INTO driver_profiles(
        user_id,nickname,nickname_key,driver_type,real_name,vehicle,country_code,gps_enabled,created_at,updated_at
      ) VALUES(
        NEW.user_id,
        'Удалённый пользователь ' || lower(hex(randomblob(4))),
        '__deleted__' || lower(hex(randomblob(12))),
        'GENERAL',NULL,NULL,NULL,0,NEW.deleted_at,NEW.deleted_at
      );
    END;
  `);
  db.prepare(`
    INSERT INTO account_schema_meta(singleton, version, updated_at) VALUES(1, ?, ?)
    ON CONFLICT(singleton) DO UPDATE SET version=excluded.version, updated_at=excluded.updated_at
  `).run(ACCOUNT_SCHEMA_VERSION, now);
  return { version: ACCOUNT_SCHEMA_VERSION };
}

module.exports = { ACCOUNT_SCHEMA_VERSION, ensureAccountSchema };
