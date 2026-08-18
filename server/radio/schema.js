const RADIO_SCHEMA_VERSION = 1;
const GENERAL_CHANNEL_KEY = "radio:general";

function ensureRadioSchema(db, now) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS radio_schema_meta (
      singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
      version INTEGER NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS radio_channel_profiles (
      channel_id INTEGER PRIMARY KEY REFERENCES radio_channels(id) ON DELETE CASCADE,
      space_kind TEXT NOT NULL CHECK(space_kind IN ('GENERAL','GROUP')),
      title TEXT NOT NULL CHECK(length(title) BETWEEN 3 AND 48),
      description TEXT NOT NULL DEFAULT '' CHECK(length(description) <= 240),
      visibility TEXT NOT NULL CHECK(visibility IN ('PUBLIC','PRIVATE')),
      talk_policy TEXT NOT NULL CHECK(talk_policy IN ('EVERYONE','TRUSTED','BROADCAST')),
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS radio_channel_member_state (
      channel_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      role TEXT NOT NULL DEFAULT 'MEMBER' CHECK(role IN ('OWNER','MODERATOR','TRUSTED','MEMBER','LISTENER')),
      muted INTEGER NOT NULL DEFAULT 0 CHECK(muted IN (0,1)),
      favorite INTEGER NOT NULL DEFAULT 0 CHECK(favorite IN (0,1)),
      last_read_transmission_id INTEGER NOT NULL DEFAULT 0 CHECK(last_read_transmission_id >= 0),
      PRIMARY KEY(channel_id, user_id),
      FOREIGN KEY(channel_id, user_id) REFERENCES radio_channel_members(channel_id, user_id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS radio_channel_invites (
      channel_id INTEGER NOT NULL REFERENCES radio_channels(id) ON DELETE CASCADE,
      target_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      invited_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY(channel_id, target_user_id)
    );

    CREATE TABLE IF NOT EXISTS radio_channel_bans (
      channel_id INTEGER NOT NULL REFERENCES radio_channels(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      blocked_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY(channel_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS radio_user_settings (
      user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'AVAILABLE' CHECK(status IN ('AVAILABLE','BUSY','SOLO')),
      solo_channel_id INTEGER REFERENCES radio_channels(id) ON DELETE SET NULL,
      default_channel_id INTEGER REFERENCES radio_channels(id) ON DELETE SET NULL,
      auto_play INTEGER NOT NULL DEFAULT 0 CHECK(auto_play IN (0,1)),
      playback_rate REAL NOT NULL DEFAULT 1.0 CHECK(playback_rate IN (1.0,1.25,1.5)),
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS radio_channel_alerts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      channel_id INTEGER NOT NULL REFERENCES radio_channels(id) ON DELETE CASCADE,
      sender_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      kind TEXT NOT NULL DEFAULT 'ATTENTION' CHECK(kind IN ('ATTENTION')),
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS radio_channel_pins (
      channel_id INTEGER NOT NULL REFERENCES radio_channels(id) ON DELETE CASCADE,
      transmission_id INTEGER NOT NULL UNIQUE REFERENCES radio_transmissions(id) ON DELETE CASCADE,
      pinned_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY(channel_id, transmission_id)
    );

    CREATE INDEX IF NOT EXISTS radio_profiles_visibility_idx
      ON radio_channel_profiles(visibility, title);
    CREATE INDEX IF NOT EXISTS radio_invites_target_idx
      ON radio_channel_invites(target_user_id, created_at);
    CREATE INDEX IF NOT EXISTS radio_alerts_channel_expiry_idx
      ON radio_channel_alerts(channel_id, expires_at);
    CREATE INDEX IF NOT EXISTS radio_member_state_favorite_idx
      ON radio_channel_member_state(user_id, favorite, channel_id);
  `);

  db.prepare(`INSERT OR IGNORE INTO radio_channels(channel_key, kind, created_at)
    VALUES(?, 'DIRECT', ?)`)
    .run(GENERAL_CHANNEL_KEY, now);
  const general = db.prepare("SELECT id FROM radio_channels WHERE channel_key = ?").get(GENERAL_CHANNEL_KEY);
  db.prepare(`INSERT OR IGNORE INTO radio_channel_profiles(
      channel_id, space_kind, title, description, visibility, talk_policy, created_by, created_at, updated_at
    ) VALUES(?, 'GENERAL', 'Общий эфир', 'Общий голосовой канал Driver Patap', 'PUBLIC', 'EVERYONE', NULL, ?, ?)`)
    .run(general.id, now, now);

  db.prepare(`INSERT INTO radio_schema_meta(singleton, version, updated_at) VALUES(1, ?, ?)
    ON CONFLICT(singleton) DO UPDATE SET version = excluded.version, updated_at = excluded.updated_at`)
    .run(RADIO_SCHEMA_VERSION, now);

  return { generalChannelId: Number(general.id), version: RADIO_SCHEMA_VERSION };
}

module.exports = { ensureRadioSchema, RADIO_SCHEMA_VERSION, GENERAL_CHANNEL_KEY };
