const EVENT_SCHEMA_VERSION = 2;

function tableColumns(db, table) {
  return new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((row) => row.name));
}

function ensureOutboxLifecycleColumns(db) {
  const columns = tableColumns(db, "driver_event_outbox");
  if (!columns.has("status")) {
    db.exec("ALTER TABLE driver_event_outbox ADD COLUMN status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','PROCESSED','FAILED'))");
  }
  if (!columns.has("failed_at")) {
    db.exec("ALTER TABLE driver_event_outbox ADD COLUMN failed_at TEXT");
  }
  db.prepare(`
    UPDATE driver_event_outbox
    SET status = CASE WHEN processed_at IS NULL THEN 'PENDING' ELSE 'PROCESSED' END
    WHERE status IS NULL OR status NOT IN ('PENDING','PROCESSED','FAILED')
  `).run();
}

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

    CREATE INDEX IF NOT EXISTS idx_driver_events_user_active ON driver_events(user_id, archived_at, updated_at DESC, id DESC);
    CREATE INDEX IF NOT EXISTS idx_driver_events_user_unread ON driver_events(user_id, read_at, archived_at, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_driver_events_source ON driver_events(user_id, source_kind, source_id, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_driver_events_expiry ON driver_events(expires_at);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_driver_events_open_dedupe ON driver_events(user_id, dedupe_key)
      WHERE dedupe_key IS NOT NULL AND read_at IS NULL AND archived_at IS NULL;

    CREATE TABLE IF NOT EXISTS driver_event_outbox (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_kind TEXT NOT NULL,
      source_ref TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      processed_at TEXT,
      attempts INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','PROCESSED','FAILED')),
      failed_at TEXT
    );
  `);
  ensureOutboxLifecycleColumns(db);
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_driver_event_outbox_pending ON driver_event_outbox(processed_at,id);
    CREATE INDEX IF NOT EXISTS idx_driver_event_outbox_status ON driver_event_outbox(status,id);
    CREATE INDEX IF NOT EXISTS idx_driver_event_outbox_failed ON driver_event_outbox(status,failed_at,id);

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
    CREATE INDEX IF NOT EXISTS idx_driver_push_subscriptions_active ON driver_push_subscriptions(user_id, revoked_at);
  `);

  // Durable source outbox: existing modules only write their own domain tables. These
  // triggers observe committed state so rejected/rolled-back actions never become events.
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS trg_event_chat_message_insert
    AFTER INSERT ON chat_messages BEGIN
      INSERT INTO driver_event_outbox(event_kind,source_ref) VALUES('CHAT_MESSAGE',CAST(NEW.id AS TEXT));
    END;

    CREATE TRIGGER IF NOT EXISTS trg_event_relationship_insert
    AFTER INSERT ON driver_relationships BEGIN
      INSERT INTO driver_event_outbox(event_kind,source_ref) VALUES('RELATIONSHIP',CAST(NEW.requester_id AS TEXT)||':'||CAST(NEW.target_id AS TEXT));
    END;
    CREATE TRIGGER IF NOT EXISTS trg_event_relationship_update
    AFTER UPDATE OF status ON driver_relationships WHEN NEW.status<>OLD.status BEGIN
      INSERT INTO driver_event_outbox(event_kind,source_ref) VALUES('RELATIONSHIP',CAST(NEW.requester_id AS TEXT)||':'||CAST(NEW.target_id AS TEXT));
    END;

    CREATE TRIGGER IF NOT EXISTS trg_event_community_invite_insert
    AFTER INSERT ON driver_community_invites BEGIN
      INSERT INTO driver_event_outbox(event_kind,source_ref) VALUES('COMMUNITY_INVITE',CAST(NEW.community_id AS TEXT)||':'||CAST(NEW.target_user_id AS TEXT));
    END;
    CREATE TRIGGER IF NOT EXISTS trg_event_community_role_update
    AFTER UPDATE OF role ON driver_community_members WHEN NEW.role<>OLD.role BEGIN
      INSERT INTO driver_event_outbox(event_kind,source_ref) VALUES('COMMUNITY_ROLE',CAST(NEW.community_id AS TEXT)||':'||CAST(NEW.user_id AS TEXT));
    END;
    CREATE TRIGGER IF NOT EXISTS trg_event_community_ban_insert
    AFTER INSERT ON driver_community_bans BEGIN
      INSERT INTO driver_event_outbox(event_kind,source_ref) VALUES('COMMUNITY_BAN',CAST(NEW.community_id AS TEXT)||':'||CAST(NEW.user_id AS TEXT));
    END;

    CREATE TRIGGER IF NOT EXISTS trg_event_radio_committed
    AFTER UPDATE OF state ON radio_transmissions WHEN NEW.state='COMMITTED' AND OLD.state<>'COMMITTED' BEGIN
      INSERT INTO driver_event_outbox(event_kind,source_ref) VALUES('RADIO_TRANSMISSION',CAST(NEW.id AS TEXT));
    END;

    CREATE TRIGGER IF NOT EXISTS trg_event_parking_occupancy_insert
    AFTER INSERT ON parking_occupancy_observations BEGIN
      INSERT INTO driver_event_outbox(event_kind,source_ref) VALUES('PARKING_OCCUPANCY',CAST(NEW.id AS TEXT));
    END;
  `);

  const current = db.prepare("SELECT version FROM driver_event_schema_meta WHERE singleton=1").get();
  if (!current) db.prepare("INSERT INTO driver_event_schema_meta(singleton,version,updated_at) VALUES(1,?,?)").run(EVENT_SCHEMA_VERSION, now);
  else if (Number(current.version) < EVENT_SCHEMA_VERSION) db.prepare("UPDATE driver_event_schema_meta SET version=?,updated_at=? WHERE singleton=1").run(EVENT_SCHEMA_VERSION, now);
}

module.exports = { EVENT_SCHEMA_VERSION, ensureEventSchema, ensureOutboxLifecycleColumns };
