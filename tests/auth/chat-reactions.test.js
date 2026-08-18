const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { DatabaseSync } = require("node:sqlite");
const { createChatRoutes } = require("../../server/chat/routes");
const { normalizeReaction } = require("../../server/chat/reactions");

function createChatDb() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT NOT NULL);
    CREATE TABLE driver_profiles (
      user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      nickname TEXT NOT NULL,
      nickname_key TEXT NOT NULL UNIQUE,
      driver_type TEXT NOT NULL,
      country_code TEXT
    );
    CREATE TABLE chat_rooms (
      id INTEGER PRIMARY KEY,
      room_key TEXT NOT NULL UNIQUE,
      kind TEXT NOT NULL,
      title TEXT NOT NULL,
      created_by INTEGER,
      created_at TEXT NOT NULL
    );
    CREATE TABLE chat_room_members (
      room_id INTEGER NOT NULL REFERENCES chat_rooms(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      joined_at TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'MEMBER',
      PRIMARY KEY(room_id, user_id)
    );
    CREATE TABLE chat_room_spaces (
      room_id INTEGER PRIMARY KEY REFERENCES chat_rooms(id) ON DELETE CASCADE,
      space_kind TEXT NOT NULL,
      country_code TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE chat_direct_pairs (
      first_user_id INTEGER NOT NULL,
      second_user_id INTEGER NOT NULL,
      room_id INTEGER NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      PRIMARY KEY(first_user_id, second_user_id)
    );
    CREATE TABLE driver_blocks (
      blocker_id INTEGER NOT NULL,
      blocked_id INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY(blocker_id, blocked_id)
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
    CREATE TABLE chat_message_reactions (
      message_id INTEGER NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      reaction TEXT NOT NULL CHECK(reaction IN ('👍','✅','👀','❤️')),
      created_at TEXT NOT NULL,
      PRIMARY KEY(message_id, user_id, reaction)
    );
  `);
  const now = "2026-08-18T10:00:00.000Z";
  for (const [id, nickname] of [[1, "Alpha"], [2, "Bravo"], [3, "Outsider"]]) {
    db.prepare("INSERT INTO users(id, username) VALUES(?, ?)").run(id, nickname.toLowerCase());
    db.prepare(`INSERT INTO driver_profiles(user_id, nickname, nickname_key, driver_type, country_code)
      VALUES(?, ?, ?, 'GENERAL', 'PL')`).run(id, nickname, nickname.toLowerCase());
  }
  db.prepare("INSERT INTO chat_rooms VALUES(1, 'general', 'GENERAL', 'Общий чат', NULL, ?)").run(now);
  db.prepare("INSERT INTO chat_room_spaces VALUES(1, 'GENERAL', NULL, ?)").run(now);
  db.prepare("INSERT INTO chat_rooms VALUES(2, 'direct:1:2', 'DIRECT', 'Личный чат', 1, ?)").run(now);
  db.prepare("INSERT INTO chat_room_spaces VALUES(2, 'DIRECT', NULL, ?)").run(now);
  db.prepare("INSERT INTO chat_room_members VALUES(2, 1, ?, 'MEMBER')").run(now);
  db.prepare("INSERT INTO chat_room_members VALUES(2, 2, ?, 'MEMBER')").run(now);
  db.prepare("INSERT INTO chat_direct_pairs VALUES(1, 2, 2, ?)").run(now);
  const generalMessageId = Number(db.prepare(`INSERT INTO chat_messages(room_id, sender_id, client_message_id, body, created_at)
    VALUES(1, 1, 'general_message_01', 'Общее сообщение', ?)`).run(now).lastInsertRowid);
  const directMessageId = Number(db.prepare(`INSERT INTO chat_messages(room_id, sender_id, client_message_id, body, created_at)
    VALUES(2, 1, 'direct_message_01', 'Личное сообщение', ?)`).run(now).lastInsertRowid);
  return { db, generalMessageId, directMessageId, now };
}

function createHarness(db) {
  const published = [];
  const audits = [];
  const handle = createChatRoutes({
    db,
    json(res, status, data) { res.status = status; res.data = data; },
    requireSession(req, res) {
      if (!req.userId) {
        res.status = 401;
        res.data = { error: "authentication_required" };
        return null;
      }
      return { user: { id: req.userId } };
    },
    requireCsrf() { return true; },
    checkRate() { return true; },
    audit(req, type, data) { audits.push({ type, data }); },
    nowIso() { return "2026-08-18T10:01:00.000Z"; },
    publish(event) { published.push(event); }
  });

  async function request(userId, pathname, { method = "GET", body } = {}) {
    const req = { method, userId };
    const res = {};
    const url = new URL(pathname, "http://test.local");
    const handled = await handle(req, res, url, body);
    assert.equal(handled, true);
    return res;
  }
  return { request, published, audits };
}

test("reaction set is fixed and rejects arbitrary emoji", () => {
  for (const key of ["👍", "✅", "👀", "❤️"]) assert.equal(normalizeReaction(key), key);
  assert.equal(normalizeReaction("🔥"), null);
  assert.equal(normalizeReaction(""), null);
});

test("reactions toggle, aggregate people, publish realtime event, and keep messages unchanged", async () => {
  const { db, generalMessageId } = createChatDb();
  const { request, published } = createHarness(db);
  const initialMessageCount = db.prepare("SELECT COUNT(*) AS n FROM chat_messages").get().n;

  let result = await request(2, `/api/driver/chat/messages/${generalMessageId}/reactions`, {
    method: "POST", body: { reaction: "👍" }
  });
  assert.equal(result.status, 200);
  assert.equal(result.data.added, true);
  assert.deepEqual(result.data.reactions, [{ key: "👍", count: 1, reactedByMe: true, people: ["Bravo"] }]);
  assert.deepEqual(published.at(-1), {
    type: "chat.reaction.updated",
    roomId: 1,
    messageId: generalMessageId,
    reactions: result.data.reactions
  });

  result = await request(2, `/api/driver/chat/messages/${generalMessageId}/reactions`, {
    method: "POST", body: { reaction: "👍" }
  });
  assert.equal(result.status, 200);
  assert.equal(result.data.added, false);
  assert.deepEqual(result.data.reactions, []);

  await request(1, `/api/driver/chat/messages/${generalMessageId}/reactions`, {
    method: "POST", body: { reaction: "✅" }
  });
  await request(2, `/api/driver/chat/messages/${generalMessageId}/reactions`, {
    method: "POST", body: { reaction: "✅" }
  });
  result = await request(1, "/api/driver/chat/rooms/1/messages");
  assert.equal(result.status, 200);
  const message = result.data.messages.find((item) => item.id === generalMessageId);
  assert.deepEqual(message.reactions, [{
    key: "✅", count: 2, reactedByMe: true, people: ["Alpha", "Bravo"]
  }]);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM chat_messages").get().n, initialMessageCount);

  result = await request(1, `/api/driver/chat/messages/${generalMessageId}/reactions`, {
    method: "POST", body: { reaction: "🔥" }
  });
  assert.equal(result.status, 400);
  assert.equal(result.data.error, "invalid_chat_reaction");
  db.close();
});

test("direct-room reactions require membership and honor blocks", async () => {
  const { db, directMessageId, now } = createChatDb();
  const { request } = createHarness(db);

  let result = await request(3, `/api/driver/chat/messages/${directMessageId}/reactions`, {
    method: "POST", body: { reaction: "👀" }
  });
  assert.equal(result.status, 404);
  assert.equal(result.data.error, "chat_room_not_found");
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM chat_message_reactions").get().n, 0);

  db.prepare("INSERT INTO driver_blocks(blocker_id, blocked_id, created_at) VALUES(1, 2, ?)").run(now);
  result = await request(2, `/api/driver/chat/messages/${directMessageId}/reactions`, {
    method: "POST", body: { reaction: "👀" }
  });
  assert.equal(result.status, 403);
  assert.equal(result.data.error, "driver_blocked");
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM chat_message_reactions").get().n, 0);
  db.close();
});

test("migration 12 preserves existing chat messages while adding reaction storage", () => {
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), "patap-reactions-migration-"));
  const dbPath = path.join(runDir, "auth.sqlite");
  const secretPath = path.join(runDir, "secret.key");
  const dbModulePath = require.resolve("../../server/auth/db");
  const previousDbPath = process.env.PATAP_DB_PATH;
  const previousSecretPath = process.env.PATAP_AUTH_SECRET_PATH;
  try {
    process.env.PATAP_DB_PATH = dbPath;
    process.env.PATAP_AUTH_SECRET_PATH = secretPath;
    delete require.cache[dbModulePath];
    let { openDb, nowIso } = require("../../server/auth/db");
    let db = openDb();
    assert.equal(db.prepare("SELECT MAX(version) AS version FROM schema_migrations").get().version, 12);
    const now = nowIso();
    const user = db.prepare(`INSERT INTO users(username, email, password_hash, role, created_at, updated_at)
      VALUES('migration_user', 'migration@example.test', 'hash', 'User', ?, ?)`).run(now, now);
    const userId = Number(user.lastInsertRowid);
    db.prepare(`INSERT INTO driver_profiles(user_id, nickname, nickname_key, driver_type, created_at, updated_at)
      VALUES(?, 'MigrationDriver', 'migrationdriver', 'GENERAL', ?, ?)`).run(userId, now, now);
    const roomId = Number(db.prepare("SELECT id FROM chat_rooms WHERE room_key = 'general'").get().id);
    db.prepare(`INSERT INTO chat_messages(room_id, sender_id, client_message_id, body, created_at)
      VALUES(?, ?, 'migration_message_01', 'Сохранить меня', ?)`).run(roomId, userId, now);
    db.exec("DROP TABLE chat_message_reactions; DELETE FROM schema_migrations WHERE version = 12;");
    db.close();

    delete require.cache[dbModulePath];
    ({ openDb } = require("../../server/auth/db"));
    db = openDb();
    assert.equal(db.prepare("SELECT MAX(version) AS version FROM schema_migrations").get().version, 12);
    assert.equal(db.prepare("SELECT body FROM chat_messages WHERE client_message_id = 'migration_message_01'").get().body, "Сохранить меня");
    assert.equal(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'chat_message_reactions'").get().name, "chat_message_reactions");
    db.close();
  } finally {
    delete require.cache[dbModulePath];
    if (previousDbPath === undefined) delete process.env.PATAP_DB_PATH; else process.env.PATAP_DB_PATH = previousDbPath;
    if (previousSecretPath === undefined) delete process.env.PATAP_AUTH_SECRET_PATH; else process.env.PATAP_AUTH_SECRET_PATH = previousSecretPath;
    fs.rmSync(runDir, { recursive: true, force: true });
  }
});
