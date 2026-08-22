const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { DatabaseSync } = require("node:sqlite");

const ROOT = path.resolve(__dirname, "..", "..");
const DB_PATH = process.env.PATAP_DB_PATH || path.join(ROOT, "data", "auth", "patap-auth.sqlite");
const DATA_DIR = path.dirname(DB_PATH);
const SECRET_PATH = process.env.PATAP_AUTH_SECRET_PATH || path.join(ROOT, "data", "config", "auth-secret.key");
const CONFIG_DIR = path.dirname(SECRET_PATH);

const ROLES = new Set(["Owner", "Administrator", "User"]);
const ROLE_ORDER = { User: 1, Administrator: 2, Owner: 3 };
const AUTH_SCHEMA_VERSION = 12;

function ensureDirs() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
}

function getSecret() {
  ensureDirs();
  if (!fs.existsSync(SECRET_PATH)) {
    fs.writeFileSync(SECRET_PATH, crypto.randomBytes(32).toString("hex"), { encoding: "utf8", mode: 0o600 });
  }
  return fs.readFileSync(SECRET_PATH, "utf8").trim();
}

function openDb() {
  ensureDirs();
  const db = new DatabaseSync(DB_PATH);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  migrate(db);
  return db;
}

function schemaObjectExists(db, type, name) {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_schema WHERE type = ? AND name = ?").get(type, name));
}

function columnExists(db, table, column) {
  return db.prepare(`PRAGMA table_info(${table})`).all().some((row) => row.name === column);
}

function assertMigrationHistory(db, current) {
  if (!Number.isSafeInteger(Number(current)) || Number(current) < 0 || Number(current) > AUTH_SCHEMA_VERSION) {
    throw new Error(`unsupported_auth_schema_version:${current}`);
  }
  const rows = db.prepare("SELECT version FROM schema_migrations ORDER BY version").all();
  if (rows.length !== Number(current) || rows.some((row, index) => Number(row.version) !== index + 1)) {
    throw new Error("auth_schema_migration_history_gap");
  }
}

function assertAuthSchemaV12(db) {
  const tables = [
    "schema_migrations", "users", "sessions", "audit_events", "rate_limits", "password_reset_tokens",
    "driver_profiles", "driver_locations", "principal_owner", "chat_rooms", "chat_room_members", "chat_messages",
    "chat_direct_pairs", "driver_relationships", "driver_blocks", "radio_channels", "radio_channel_members",
    "radio_direct_pairs", "radio_speaker_leases", "radio_transmissions", "chat_room_spaces", "chat_message_reactions"
  ];
  const indexes = [
    "driver_locations_updated_at_idx", "chat_messages_room_cursor_idx", "chat_room_members_user_idx",
    "driver_relationships_target_idx", "driver_blocks_blocked_idx", "radio_channel_members_user_idx",
    "radio_transmissions_channel_cursor_idx", "radio_transmissions_expiry_idx", "chat_room_spaces_country_idx",
    "chat_message_reactions_message_idx"
  ];
  const triggers = [
    "principal_owner_first_insert", "prevent_additional_owner_insert", "prevent_owner_promotion",
    "protect_principal_owner_state", "protect_principal_owner_delete"
  ];
  for (const name of tables) if (!schemaObjectExists(db, "table", name)) throw new Error(`auth_schema_missing_table:${name}`);
  for (const name of indexes) if (!schemaObjectExists(db, "index", name)) throw new Error(`auth_schema_missing_index:${name}`);
  for (const name of triggers) if (!schemaObjectExists(db, "trigger", name)) throw new Error(`auth_schema_missing_trigger:${name}`);
  for (const [table, column] of [["driver_profiles", "gps_enabled"], ["driver_profiles", "country_code"], ["chat_room_members", "role"]]) {
    if (!columnExists(db, table, column)) throw new Error(`auth_schema_missing_column:${table}.${column}`);
  }
}

function runMigrationTransaction(db, apply) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = apply();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    try { db.exec("ROLLBACK"); } catch {}
    throw error;
  }
}

function migrationFailure(error, current) {
  const message = String(error?.message || error);
  if (/already exists|duplicate column name|UNIQUE constraint failed:\s*schema_migrations/i.test(message)) {
    const out = new Error(`legacy_partial_migration_detected:v${current}:${message}`);
    out.code = "LEGACY_PARTIAL_MIGRATION";
    out.cause = error;
    return out;
  }
  return error;
}

function migrate(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `);
  const before = Number(db.prepare("SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations").get().version);
  assertMigrationHistory(db, before);
  if (before === AUTH_SCHEMA_VERSION) {
    assertAuthSchemaV12(db);
    return;
  }

  try {
    runMigrationTransaction(db, () => {
      const current = Number(db.prepare("SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations").get().version);
      assertMigrationHistory(db, current);
      if (current < 1) {
        db.exec(`
          CREATE TABLE users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL UNIQUE,
            email TEXT NOT NULL UNIQUE,
            password_hash TEXT NOT NULL,
            role TEXT NOT NULL CHECK(role IN ('Owner','Administrator','User')),
            disabled INTEGER NOT NULL DEFAULT 0,
            locked_until TEXT,
            failed_login_count INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            last_login_at TEXT,
            last_seen_at TEXT
          );

          CREATE TABLE sessions (
            id TEXT PRIMARY KEY,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            csrf_token TEXT NOT NULL,
            created_at TEXT NOT NULL,
            expires_at TEXT NOT NULL,
            last_seen_at TEXT NOT NULL,
            revoked_at TEXT,
            ip TEXT,
            user_agent TEXT
          );

          CREATE TABLE audit_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            created_at TEXT NOT NULL,
            event_type TEXT NOT NULL,
            user_id INTEGER,
            target_user_id INTEGER,
            success INTEGER NOT NULL,
            source_ip TEXT,
            user_agent TEXT,
            details TEXT
          );

          CREATE TABLE rate_limits (
            key TEXT PRIMARY KEY,
            count INTEGER NOT NULL,
            reset_at TEXT NOT NULL
          );

          CREATE TABLE password_reset_tokens (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            token_hash TEXT NOT NULL UNIQUE,
            created_at TEXT NOT NULL,
            expires_at TEXT NOT NULL,
            used_at TEXT
          );
        `);
        db.prepare("INSERT INTO schema_migrations(version, applied_at) VALUES(1, ?)").run(nowIso());
      }
      if (current < 2) {
        db.exec(`
          CREATE TABLE driver_profiles (
            user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
            nickname TEXT NOT NULL,
            nickname_key TEXT NOT NULL UNIQUE,
            driver_type TEXT NOT NULL CHECK(driver_type IN ('TIR','TAXI','DELIVERY','GENERAL')),
            real_name TEXT,
            vehicle TEXT,
            language TEXT,
            country TEXT,
            city TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
          );
        `);
        db.prepare("INSERT INTO schema_migrations(version, applied_at) VALUES(2, ?)").run(nowIso());
      }
      if (current < 3) {
        db.exec(`
          CREATE TABLE driver_locations (
            user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
            latitude REAL NOT NULL CHECK(latitude >= -90 AND latitude <= 90),
            longitude REAL NOT NULL CHECK(longitude >= -180 AND longitude <= 180),
            accuracy_m REAL NOT NULL CHECK(accuracy_m >= 0 AND accuracy_m <= 10000),
            updated_at TEXT NOT NULL
          );
          CREATE INDEX driver_locations_updated_at_idx ON driver_locations(updated_at);
        `);
        db.prepare("INSERT INTO schema_migrations(version, applied_at) VALUES(3, ?)").run(nowIso());
      }
      if (current < 4) {
        db.exec(`
          CREATE TABLE principal_owner (
            singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
            user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE RESTRICT,
            created_at TEXT NOT NULL
          );
        `);
        const owners = db.prepare("SELECT id FROM users WHERE role = 'Owner' ORDER BY id").all();
        if (owners.length > 1) throw new Error("Migration 4 requires exactly zero or one existing Owner");
        if (owners.length === 1) {
          db.prepare("INSERT INTO principal_owner(singleton, user_id, created_at) VALUES(1, ?, ?)")
            .run(owners[0].id, nowIso());
        }
        db.exec(`
          CREATE TRIGGER principal_owner_first_insert
          AFTER INSERT ON users
          WHEN NEW.role = 'Owner' AND NOT EXISTS (SELECT 1 FROM principal_owner WHERE singleton = 1)
          BEGIN
            INSERT INTO principal_owner(singleton, user_id, created_at)
            VALUES(1, NEW.id, NEW.created_at);
          END;

          CREATE TRIGGER prevent_additional_owner_insert
          BEFORE INSERT ON users
          WHEN NEW.role = 'Owner' AND EXISTS (SELECT 1 FROM principal_owner WHERE singleton = 1)
          BEGIN
            SELECT RAISE(ABORT, 'principal_owner_exists');
          END;

          CREATE TRIGGER prevent_owner_promotion
          BEFORE UPDATE OF role ON users
          WHEN NEW.role = 'Owner'
            AND NOT EXISTS (SELECT 1 FROM principal_owner WHERE user_id = OLD.id)
          BEGIN
            SELECT RAISE(ABORT, 'principal_owner_exists');
          END;

          CREATE TRIGGER protect_principal_owner_state
          BEFORE UPDATE OF role, disabled ON users
          WHEN EXISTS (SELECT 1 FROM principal_owner WHERE user_id = OLD.id)
            AND (NEW.role <> 'Owner' OR NEW.disabled <> 0)
          BEGIN
            SELECT RAISE(ABORT, 'principal_owner_protected');
          END;

          CREATE TRIGGER protect_principal_owner_delete
          BEFORE DELETE ON users
          WHEN EXISTS (SELECT 1 FROM principal_owner WHERE user_id = OLD.id)
          BEGIN
            SELECT RAISE(ABORT, 'principal_owner_protected');
          END;
        `);
        db.prepare("INSERT INTO schema_migrations(version, applied_at) VALUES(4, ?)").run(nowIso());
      }
      if (current < 5) {
        db.exec(`
          CREATE TABLE chat_rooms (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            room_key TEXT NOT NULL UNIQUE,
            kind TEXT NOT NULL CHECK(kind IN ('GENERAL','DIRECT')),
            title TEXT NOT NULL,
            created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
            created_at TEXT NOT NULL
          );

          CREATE TABLE chat_room_members (
            room_id INTEGER NOT NULL REFERENCES chat_rooms(id) ON DELETE CASCADE,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            joined_at TEXT NOT NULL,
            PRIMARY KEY(room_id, user_id)
          );

          CREATE TABLE chat_messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            room_id INTEGER NOT NULL REFERENCES chat_rooms(id) ON DELETE CASCADE,
            sender_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            client_message_id TEXT NOT NULL,
            body TEXT NOT NULL,
            created_at TEXT NOT NULL,
            UNIQUE(sender_id, client_message_id)
          );

          CREATE INDEX chat_messages_room_cursor_idx ON chat_messages(room_id, id);
          CREATE INDEX chat_room_members_user_idx ON chat_room_members(user_id, room_id);
        `);
        db.prepare(`
          INSERT INTO chat_rooms(room_key, kind, title, created_by, created_at)
          VALUES('general', 'GENERAL', 'Общий чат', NULL, ?)
        `).run(nowIso());
        db.prepare("INSERT INTO schema_migrations(version, applied_at) VALUES(5, ?)").run(nowIso());
      }
      if (current < 6) {
        db.exec(`
          ALTER TABLE driver_profiles ADD COLUMN gps_enabled INTEGER NOT NULL DEFAULT 0 CHECK(gps_enabled IN (0, 1));
          UPDATE driver_profiles
          SET gps_enabled = 1
          WHERE user_id IN (SELECT user_id FROM driver_locations);
        `);
        db.prepare("INSERT INTO schema_migrations(version, applied_at) VALUES(6, ?)").run(nowIso());
      }
      if (current < 7) {
        db.exec(`
          CREATE TABLE chat_direct_pairs (
            first_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            second_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            room_id INTEGER NOT NULL UNIQUE REFERENCES chat_rooms(id) ON DELETE CASCADE,
            created_at TEXT NOT NULL,
            PRIMARY KEY(first_user_id, second_user_id),
            CHECK(first_user_id < second_user_id)
          );
          INSERT INTO chat_direct_pairs(first_user_id, second_user_id, room_id, created_at)
          SELECT MIN(member.user_id), MAX(member.user_id), room.id, room.created_at
          FROM chat_rooms room
          JOIN chat_room_members member ON member.room_id = room.id
          WHERE room.kind = 'DIRECT'
          GROUP BY room.id
          HAVING COUNT(*) = 2;
        `);
        db.prepare("INSERT INTO schema_migrations(version, applied_at) VALUES(7, ?)").run(nowIso());
      }
      if (current < 8) {
        db.exec(`
          CREATE TABLE driver_relationships (
            requester_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            target_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            status TEXT NOT NULL CHECK(status IN ('PENDING','ACCEPTED')),
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            PRIMARY KEY(requester_id, target_id),
            CHECK(requester_id != target_id)
          );
          CREATE TABLE driver_blocks (
            blocker_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            blocked_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            created_at TEXT NOT NULL,
            PRIMARY KEY(blocker_id, blocked_id),
            CHECK(blocker_id != blocked_id)
          );
          CREATE INDEX driver_relationships_target_idx ON driver_relationships(target_id, status);
          CREATE INDEX driver_blocks_blocked_idx ON driver_blocks(blocked_id);
        `);
        db.prepare("INSERT INTO schema_migrations(version, applied_at) VALUES(8, ?)").run(nowIso());
      }
      if (current < 9) {
        db.exec("ALTER TABLE driver_profiles ADD COLUMN country_code TEXT;");
        db.prepare("INSERT INTO schema_migrations(version, applied_at) VALUES(9, ?)").run(nowIso());
      }
      if (current < 10) {
        db.exec(`
          CREATE TABLE radio_channels (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            channel_key TEXT NOT NULL UNIQUE,
            kind TEXT NOT NULL CHECK(kind IN ('DIRECT')),
            created_at TEXT NOT NULL
          );
          CREATE TABLE radio_channel_members (
            channel_id INTEGER NOT NULL REFERENCES radio_channels(id) ON DELETE CASCADE,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            joined_at TEXT NOT NULL,
            PRIMARY KEY(channel_id, user_id)
          );
          CREATE TABLE radio_direct_pairs (
            first_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            second_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            channel_id INTEGER NOT NULL UNIQUE REFERENCES radio_channels(id) ON DELETE CASCADE,
            created_at TEXT NOT NULL,
            PRIMARY KEY(first_user_id, second_user_id),
            CHECK(first_user_id < second_user_id)
          );
          CREATE TABLE radio_speaker_leases (
            channel_id INTEGER PRIMARY KEY REFERENCES radio_channels(id) ON DELETE CASCADE,
            speaker_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            upload_token_hash TEXT NOT NULL,
            expires_at TEXT NOT NULL
          );
          CREATE TABLE radio_transmissions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            channel_id INTEGER NOT NULL REFERENCES radio_channels(id) ON DELETE CASCADE,
            sender_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            upload_token_hash TEXT NOT NULL,
            mime_type TEXT,
            byte_length INTEGER NOT NULL DEFAULT 0 CHECK(byte_length >= 0),
            storage_key TEXT NOT NULL UNIQUE,
            state TEXT NOT NULL CHECK(state IN ('UPLOADING','COMMITTED','EXPIRED')),
            created_at TEXT NOT NULL,
            expires_at TEXT NOT NULL,
            committed_at TEXT
          );
          CREATE INDEX radio_channel_members_user_idx ON radio_channel_members(user_id, channel_id);
          CREATE INDEX radio_transmissions_channel_cursor_idx ON radio_transmissions(channel_id, id DESC);
          CREATE INDEX radio_transmissions_expiry_idx ON radio_transmissions(expires_at, state);
        `);
        db.prepare("INSERT INTO schema_migrations(version, applied_at) VALUES(10, ?)").run(nowIso());
      }
      if (current < 11) {
        // Keep the legacy room table and ids intact. This adds a single source
        // of truth for space semantics while preserving GENERAL/DIRECT history.
        db.exec(`
          CREATE TABLE chat_room_spaces (
            room_id INTEGER PRIMARY KEY REFERENCES chat_rooms(id) ON DELETE CASCADE,
            space_kind TEXT NOT NULL CHECK(space_kind IN ('GENERAL','DIRECT','COUNTRY')),
            country_code TEXT,
            created_at TEXT NOT NULL,
            CHECK((space_kind = 'COUNTRY' AND country_code IS NOT NULL)
              OR (space_kind <> 'COUNTRY' AND country_code IS NULL))
          );
          CREATE INDEX chat_room_spaces_country_idx ON chat_room_spaces(space_kind, country_code);
        `);
        db.prepare(`
          INSERT INTO chat_room_spaces(room_id, space_kind, country_code, created_at)
          SELECT id, kind, NULL, created_at FROM chat_rooms
        `).run();
        db.exec(`
          ALTER TABLE chat_room_members ADD COLUMN role TEXT NOT NULL DEFAULT 'MEMBER'
            CHECK(role IN ('OWNER','ADMIN','MODERATOR','MEMBER','READONLY'));
        `);
        db.prepare("INSERT INTO schema_migrations(version, applied_at) VALUES(11, ?)").run(nowIso());
      }
      if (current < 12) {
        // Additive migration only: existing rooms, members and messages stay intact.
        db.exec(`
          CREATE TABLE chat_message_reactions (
            message_id INTEGER NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            reaction TEXT NOT NULL CHECK(reaction IN ('👍','✅','👀','❤️')),
            created_at TEXT NOT NULL,
            PRIMARY KEY(message_id, user_id, reaction)
          );
          CREATE INDEX chat_message_reactions_message_idx
            ON chat_message_reactions(message_id, reaction, user_id);
        `);
        db.prepare("INSERT INTO schema_migrations(version, applied_at) VALUES(12, ?)").run(nowIso());
      }

      const after = Number(db.prepare("SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations").get().version);
      if (after !== AUTH_SCHEMA_VERSION) throw new Error(`auth_schema_migration_incomplete:${after}`);
      assertMigrationHistory(db, after);
      assertAuthSchemaV12(db);
      const foreignKeyErrors = db.prepare("PRAGMA foreign_key_check").all();
      if (foreignKeyErrors.length) throw new Error(`auth_schema_foreign_key_check_failed:${foreignKeyErrors.length}`);
    });
  } catch (error) {
    throw migrationFailure(error, before);
  }
}

function nowIso(date = new Date()) {
  return date.toISOString();
}

function addMinutes(minutes) {
  return nowIso(new Date(Date.now() + minutes * 60 * 1000));
}

function normalizeUsername(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function validateUsername(username) {
  return /^[a-z0-9][a-z0-9_-]{2,31}$/.test(username);
}

function validateEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254;
}

function validatePassword(password) {
  return typeof password === "string" && password.length >= 6 && password.length <= 128;
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const derived = crypto.scryptSync(password, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  return `scrypt$v=1$N=32768$r=8$p=1$${salt}$${derived.toString("hex")}`;
}

function verifyPassword(password, encoded) {
  try {
    const parts = encoded.split("$");
    if (parts[0] !== "scrypt") return false;
    const params = Object.fromEntries(parts.slice(2, 5).map((part) => part.split("=")));
    const salt = parts[5];
    const expected = Buffer.from(parts[6], "hex");
    const actual = crypto.scryptSync(password, salt, expected.length, {
      N: Number(params.N),
      r: Number(params.r),
      p: Number(params.p),
      maxmem: 64 * 1024 * 1024
    });
    return crypto.timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

function hashToken(token, secret = getSecret()) {
  return crypto.createHmac("sha256", secret).update(token).digest("hex");
}

function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString("base64url");
}

function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    role: user.role,
    disabled: Boolean(user.disabled),
    createdAt: user.created_at,
    lastLoginAt: user.last_login_at,
    lastSeenAt: user.last_seen_at
  };
}

function canManageRole(actorRole, targetRole) {
  if (actorRole !== "Owner") return false;
  return ROLES.has(targetRole);
}

function canAdmin(actorRole) {
  return actorRole === "Owner" || actorRole === "Administrator";
}

function assertRole(role) {
  if (!ROLES.has(role)) {
    throw new Error("Invalid role");
  }
}

function roleLevel(role) {
  return ROLE_ORDER[role] || 0;
}

module.exports = {
  ROOT,
  DATA_DIR,
  DB_PATH,
  SECRET_PATH,
  ROLES,
  AUTH_SCHEMA_VERSION,
  openDb,
  migrate,
  runMigrationTransaction,
  assertMigrationHistory,
  assertAuthSchemaV12,
  getSecret,
  nowIso,
  addMinutes,
  normalizeUsername,
  normalizeEmail,
  validateUsername,
  validateEmail,
  validatePassword,
  hashPassword,
  verifyPassword,
  hashToken,
  randomToken,
  publicUser,
  canAdmin,
  canManageRole,
  assertRole,
  roleLevel
};