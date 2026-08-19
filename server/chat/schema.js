const CHAT_SCHEMA_VERSION = 1;

function tableExists(db, name) {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name));
}

function ensureChatSchema(db, now = new Date().toISOString()) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS chat_schema_meta (
      singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
      version INTEGER NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  const row = db.prepare("SELECT version FROM chat_schema_meta WHERE singleton = 1").get();
  const current = Number(row?.version || 0);
  if (current >= CHAT_SCHEMA_VERSION) return { version: current };

  db.exec(`
    CREATE TABLE IF NOT EXISTS chat_room_profiles (
      room_id INTEGER PRIMARY KEY REFERENCES chat_rooms(id) ON DELETE CASCADE,
      space_kind TEXT NOT NULL CHECK(space_kind IN ('GROUP')),
      description TEXT NOT NULL DEFAULT '',
      visibility TEXT NOT NULL CHECK(visibility IN ('PUBLIC','PRIVATE')),
      history_policy TEXT NOT NULL DEFAULT 'FULL' CHECK(history_policy IN ('FULL','JOINED')),
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS chat_room_invites (
      room_id INTEGER NOT NULL REFERENCES chat_rooms(id) ON DELETE CASCADE,
      target_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      invited_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY(room_id, target_user_id)
    );

    CREATE TABLE IF NOT EXISTS chat_room_bans (
      room_id INTEGER NOT NULL REFERENCES chat_rooms(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      blocked_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY(room_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS chat_room_member_state (
      room_id INTEGER NOT NULL REFERENCES chat_rooms(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      last_delivered_message_id INTEGER NOT NULL DEFAULT 0,
      last_read_message_id INTEGER NOT NULL DEFAULT 0,
      muted INTEGER NOT NULL DEFAULT 0 CHECK(muted IN (0,1)),
      favorite INTEGER NOT NULL DEFAULT 0 CHECK(favorite IN (0,1)),
      archived INTEGER NOT NULL DEFAULT 0 CHECK(archived IN (0,1)),
      pinned_rank INTEGER,
      notification_level TEXT NOT NULL DEFAULT 'ALL' CHECK(notification_level IN ('ALL','MENTIONS','NONE')),
      updated_at TEXT NOT NULL,
      PRIMARY KEY(room_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS chat_message_meta (
      message_id INTEGER PRIMARY KEY REFERENCES chat_messages(id) ON DELETE CASCADE,
      reply_to_message_id INTEGER REFERENCES chat_messages(id) ON DELETE SET NULL,
      forwarded_from_message_id INTEGER REFERENCES chat_messages(id) ON DELETE SET NULL,
      edited_at TEXT,
      deleted_at TEXT,
      expires_at TEXT
    );

    CREATE TABLE IF NOT EXISTS chat_uploads (
      id TEXT PRIMARY KEY,
      room_id INTEGER NOT NULL REFERENCES chat_rooms(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      upload_token_hash TEXT NOT NULL,
      kind TEXT NOT NULL CHECK(kind IN ('IMAGE','VIDEO','AUDIO','FILE')),
      file_name TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      byte_length INTEGER NOT NULL CHECK(byte_length >= 0),
      storage_key TEXT NOT NULL UNIQUE,
      duration_ms INTEGER,
      state TEXT NOT NULL CHECK(state IN ('PENDING','READY','ATTACHED')),
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS chat_message_attachments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      message_id INTEGER NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
      kind TEXT NOT NULL CHECK(kind IN ('IMAGE','VIDEO','AUDIO','FILE')),
      file_name TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      byte_length INTEGER NOT NULL CHECK(byte_length >= 0),
      storage_key TEXT NOT NULL,
      duration_ms INTEGER,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS chat_message_reactions_v2 (
      message_id INTEGER NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      reaction TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY(message_id, user_id, reaction)
    );

    CREATE TABLE IF NOT EXISTS chat_room_pins (
      room_id INTEGER NOT NULL REFERENCES chat_rooms(id) ON DELETE CASCADE,
      message_id INTEGER NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
      pinned_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY(room_id, message_id)
    );

    CREATE TABLE IF NOT EXISTS chat_message_mentions (
      message_id INTEGER NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      kind TEXT NOT NULL CHECK(kind IN ('DIRECT','ALL')),
      PRIMARY KEY(message_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS chat_hidden_messages (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      message_id INTEGER NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
      hidden_at TEXT NOT NULL,
      PRIMARY KEY(user_id, message_id)
    );

    CREATE TABLE IF NOT EXISTS chat_polls (
      message_id INTEGER PRIMARY KEY REFERENCES chat_messages(id) ON DELETE CASCADE,
      question TEXT NOT NULL,
      multiple INTEGER NOT NULL DEFAULT 0 CHECK(multiple IN (0,1)),
      anonymous INTEGER NOT NULL DEFAULT 0 CHECK(anonymous IN (0,1)),
      closes_at TEXT,
      closed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS chat_poll_options (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      message_id INTEGER NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
      option_index INTEGER NOT NULL,
      body TEXT NOT NULL,
      UNIQUE(message_id, option_index)
    );

    CREATE TABLE IF NOT EXISTS chat_poll_votes (
      message_id INTEGER NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
      option_id INTEGER NOT NULL REFERENCES chat_poll_options(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL,
      PRIMARY KEY(message_id, option_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS chat_drafts (
      room_id INTEGER NOT NULL REFERENCES chat_rooms(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      body TEXT NOT NULL DEFAULT '',
      reply_to_message_id INTEGER REFERENCES chat_messages(id) ON DELETE SET NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY(room_id, user_id)
    );

    CREATE INDEX IF NOT EXISTS chat_room_profiles_visibility_idx ON chat_room_profiles(visibility, room_id);
    CREATE INDEX IF NOT EXISTS chat_room_invites_target_idx ON chat_room_invites(target_user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS chat_room_member_state_user_idx ON chat_room_member_state(user_id, archived, pinned_rank, room_id);
    CREATE INDEX IF NOT EXISTS chat_message_meta_expiry_idx ON chat_message_meta(expires_at, deleted_at);
    CREATE INDEX IF NOT EXISTS chat_uploads_expiry_idx ON chat_uploads(state, expires_at);
    CREATE INDEX IF NOT EXISTS chat_message_attachments_message_idx ON chat_message_attachments(message_id, id);
    CREATE INDEX IF NOT EXISTS chat_message_reactions_v2_message_idx ON chat_message_reactions_v2(message_id, reaction, user_id);
    CREATE INDEX IF NOT EXISTS chat_room_pins_room_idx ON chat_room_pins(room_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS chat_message_mentions_user_idx ON chat_message_mentions(user_id, message_id);
    CREATE INDEX IF NOT EXISTS chat_poll_votes_message_idx ON chat_poll_votes(message_id, option_id);
  `);

  if (tableExists(db, "chat_message_reactions")) {
    db.exec(`
      INSERT OR IGNORE INTO chat_message_reactions_v2(message_id, user_id, reaction, created_at)
      SELECT message_id, user_id, reaction, created_at FROM chat_message_reactions;
    `);
  }

  db.prepare(`
    INSERT INTO chat_schema_meta(singleton, version, updated_at) VALUES(1, ?, ?)
    ON CONFLICT(singleton) DO UPDATE SET version = excluded.version, updated_at = excluded.updated_at
  `).run(CHAT_SCHEMA_VERSION, now);
  return { version: CHAT_SCHEMA_VERSION };
}

module.exports = { CHAT_SCHEMA_VERSION, ensureChatSchema };
