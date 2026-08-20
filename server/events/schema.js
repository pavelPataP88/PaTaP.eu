const EVENT_SCHEMA_VERSION = 1;

function ensureEventSchema(db, now = new Date().toISOString()) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS driver_event_schema_meta (
      singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
      version INTEGER NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS driver_event_preferences (
      user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
      driving_mode INTEGER NOT NULL DEFAULT 0 CHECK(driving_mode IN (0,1)),
      quiet_enabled INTEGER NOT NULL DEFAULT 0 CHECK(quiet_enabled IN (0,1)),
      quiet_start TEXT NOT NULL DEFAULT '22:00',
      quiet_end TEXT NOT NULL DEFAULT '07:00',
      timezone TEXT NOT NULL DEFAULT 'Europe/Warsaw',
      show_previews INTEGER NOT NULL DEFAULT 1 CHECK(show_previews IN (0,1)),
      in_app_popups INTEGER NOT NULL DEFAULT 1 CHECK(in_app_popups IN (0,1)),
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS driver_event_category_preferences (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      category TEXT NOT NULL CHECK(category IN ('CHAT','PEOPLE','COMMUNITY','RADIO','ROAD','PARKING','SYSTEM')),
      inbox_enabled INTEGER NOT NULL DEFAULT 1 CHECK(inbox_enabled IN (0,1)),
      push_enabled INTEGER NOT NULL DEFAULT 1 CHECK(push_enabled IN (0,1)),
      min_priority TEXT NOT NULL DEFAULT 'NORMAL' CHECK(min_priority IN ('URGENT','IMPORTANT','NORMAL','SILENT')),
      updated_at TEXT NOT NULL,
      PRIMARY KEY(user_id, category)
    );

    CREATE TABLE IF NOT EXISTS driver_event_source_overrides (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      source_kind TEXT NOT NULL,
      source_id TEXT NOT NULL,
      mode TEXT NOT NULL CHECK(mode IN ('ALL','IMPORTANT','MUTED')),
      updated_at TEXT NOT NULL,
      PRIMARY KEY(user_id, source_kind, source_id)
    );

    CREATE TABLE IF NOT EXISTS driver_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      event_type TEXT NOT NULL,
      category TEXT NOT NULL CHECK(category IN ('CHAT','PEOPLE','COMMUNITY','RADIO','ROAD','PARKING','SYSTEM')),
      priority TEXT NOT NULL CHECK(priority IN ('URGENT','IMPORTANT','NORMAL','SILENT')),
      actor_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      source_kind TEXT NOT NULL,
      source_id TEXT NOT NULL,
      title TEXT NOT NULL,
      preview TEXT NOT NULL DEFAULT '',
      route_json TEXT NOT NULL DEFAULT '{}',
      data_json TEXT NOT NULL DEFAULT '{}',
      dedupe_key TEXT,
      occurrence_count INTEGER NOT NULL DEFAULT 1 CHECK(occurrence_count >= 1),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      read_at TEXT,
      archived_at TEXT,
      snoozed_until TEXT,
      expires_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_driver_events_user_active
      ON driver_events(user_id, archived_at, updated_at DESC, id DESC);
    CREATE INDEX IF NOT EXISTS idx_driver_events_user_unread
      ON driver_events(user_id, read_at, archived_at, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_driver_events_source
      ON driver_events(user_id, source_kind, source_id, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_driver_events_expiry
      ON driver_events(expires_at);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_driver_events_open_dedupe
      ON driver_events(user_id, dedupe_key)
      WHERE dedupe_key IS NOT NULL AND read_at IS NULL AND archived_at IS NULL;

    CREATE TABLE IF NOT EXISTS driver_push_subscriptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      endpoint TEXT NOT NULL,
      p256dh TEXT NOT NULL,
      auth TEXT NOT NULL,
      user_agent TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_success_at TEXT,
      failure_count INTEGER NOT NULL DEFAULT 0,
      revoked_at TEXT,
      UNIQUE(user_id, endpoint)
    );
    CREATE INDEX IF NOT EXISTS idx_driver_push_subscriptions_active
      ON driver_push_subscriptions(user_id, revoked_at);
  `);

  const current = db.prepare("SELECT version FROM driver_event_schema_meta WHERE singleton=1").get();
  if (!current) {
    db.prepare("INSERT INTO driver_event_schema_meta(singleton,version,updated_at) VALUES(1,?,?)")
      .run(EVENT_SCHEMA_VERSION, now);
  } else if (Number(current.version) < EVENT_SCHEMA_VERSION) {
    db.prepare("UPDATE driver_event_schema_meta SET version=?,updated_at=? WHERE singleton=1")
      .run(EVENT_SCHEMA_VERSION, now);
  }
}

module.exports = { EVENT_SCHEMA_VERSION, ensureEventSchema };
