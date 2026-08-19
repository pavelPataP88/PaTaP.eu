const PEOPLE_SCHEMA_VERSION = 1;

function ensurePeopleSchema(db, now = new Date().toISOString()) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS people_schema_meta (
      singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
      version INTEGER NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS driver_people_settings (
      user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      discoverability TEXT NOT NULL DEFAULT 'EVERYONE'
        CHECK(discoverability IN ('EVERYONE','CONTACTS','HIDDEN')),
      nearby_visibility TEXT NOT NULL DEFAULT 'EVERYONE'
        CHECK(nearby_visibility IN ('EVERYONE','CONTACTS','TRUSTED','NOBODY')),
      contact_requests TEXT NOT NULL DEFAULT 'EVERYONE'
        CHECK(contact_requests IN ('EVERYONE','NOBODY')),
      community_invites TEXT NOT NULL DEFAULT 'CONTACTS'
        CHECK(community_invites IN ('CONTACTS','NOBODY')),
      vehicle_visibility TEXT NOT NULL DEFAULT 'EVERYONE'
        CHECK(vehicle_visibility IN ('EVERYONE','CONTACTS','NOBODY')),
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS driver_contact_preferences (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      target_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      favorite INTEGER NOT NULL DEFAULT 0 CHECK(favorite IN (0,1)),
      trusted INTEGER NOT NULL DEFAULT 0 CHECK(trusted IN (0,1)),
      private_note TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL,
      PRIMARY KEY(user_id, target_user_id),
      CHECK(user_id != target_user_id)
    );

    CREATE TABLE IF NOT EXISTS driver_communities (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      community_key TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      visibility TEXT NOT NULL CHECK(visibility IN ('PUBLIC','PRIVATE')),
      category TEXT NOT NULL DEFAULT 'GENERAL'
        CHECK(category IN ('GENERAL','TIR','TAXI','DELIVERY','LOCAL')),
      country_code TEXT,
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      chat_room_id INTEGER NOT NULL UNIQUE REFERENCES chat_rooms(id) ON DELETE CASCADE,
      radio_channel_id INTEGER NOT NULL UNIQUE REFERENCES radio_channels(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS driver_community_members (
      community_id INTEGER NOT NULL REFERENCES driver_communities(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role TEXT NOT NULL DEFAULT 'MEMBER' CHECK(role IN ('OWNER','MODERATOR','MEMBER')),
      favorite INTEGER NOT NULL DEFAULT 0 CHECK(favorite IN (0,1)),
      joined_at TEXT NOT NULL,
      PRIMARY KEY(community_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS driver_community_invites (
      community_id INTEGER NOT NULL REFERENCES driver_communities(id) ON DELETE CASCADE,
      target_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      invited_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY(community_id, target_user_id)
    );

    CREATE TABLE IF NOT EXISTS driver_community_bans (
      community_id INTEGER NOT NULL REFERENCES driver_communities(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      blocked_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY(community_id, user_id)
    );

    CREATE INDEX IF NOT EXISTS driver_contact_preferences_target_idx
      ON driver_contact_preferences(target_user_id, trusted, favorite);
    CREATE INDEX IF NOT EXISTS driver_community_members_user_idx
      ON driver_community_members(user_id, favorite, community_id);
    CREATE INDEX IF NOT EXISTS driver_community_invites_target_idx
      ON driver_community_invites(target_user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS driver_communities_discover_idx
      ON driver_communities(visibility, category, country_code, id DESC);
  `);

  const current = Number(db.prepare("SELECT version FROM people_schema_meta WHERE singleton = 1").get()?.version || 0);
  if (current < PEOPLE_SCHEMA_VERSION) {
    db.prepare(`
      INSERT INTO people_schema_meta(singleton, version, updated_at) VALUES(1, ?, ?)
      ON CONFLICT(singleton) DO UPDATE SET version = excluded.version, updated_at = excluded.updated_at
    `).run(PEOPLE_SCHEMA_VERSION, now);
  }
  return { version: PEOPLE_SCHEMA_VERSION };
}

module.exports = { PEOPLE_SCHEMA_VERSION, ensurePeopleSchema };
