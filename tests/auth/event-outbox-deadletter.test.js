const test = require("node:test");
const assert = require("node:assert/strict");
const { DatabaseSync } = require("node:sqlite");
const { ensureOutboxLifecycleColumns } = require("../../server/events/schema");
const { createEventDispatcher } = require("../../server/events/dispatcher");
const { createEventRoutes } = require("../../server/events/routes");

function createOutboxDb() {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE driver_event_outbox (
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
    CREATE TABLE chat_messages (id INTEGER PRIMARY KEY, room_id INTEGER NOT NULL);
    CREATE TABLE chat_polls (message_id INTEGER PRIMARY KEY);
    CREATE TABLE chat_message_attachments (id INTEGER PRIMARY KEY, message_id INTEGER NOT NULL);
  `);
  return db;
}

test("legacy Event Outbox rows gain explicit lifecycle state without losing processed history", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE driver_event_outbox (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_kind TEXT NOT NULL,
      source_ref TEXT NOT NULL,
      created_at TEXT NOT NULL,
      processed_at TEXT,
      attempts INTEGER NOT NULL DEFAULT 0,
      last_error TEXT
    );
  `);
  db.prepare("INSERT INTO driver_event_outbox(event_kind,source_ref,created_at,processed_at) VALUES('CHAT_MESSAGE','1',?,NULL)").run("2026-08-01T00:00:00.000Z");
  db.prepare("INSERT INTO driver_event_outbox(event_kind,source_ref,created_at,processed_at) VALUES('CHAT_MESSAGE','2',?,?)").run("2026-08-01T00:00:00.000Z","2026-08-01T00:01:00.000Z");

  ensureOutboxLifecycleColumns(db);
  const rows = db.prepare("SELECT id,status,failed_at FROM driver_event_outbox ORDER BY id").all();
  assert.deepEqual(rows.map((row) => row.status), ["PENDING", "PROCESSED"]);
  assert.equal(rows[0].failed_at, null);
  db.close();
});

test("Event Outbox dead-letters after five failures, stops auto-retry, and succeeds after explicit retry", () => {
  const db = createOutboxDb();
  db.prepare("INSERT INTO chat_messages(id,room_id) VALUES(1,9)").run();
  db.prepare("INSERT INTO driver_event_outbox(event_kind,source_ref,created_at) VALUES('CHAT_MESSAGE','1',?)").run("2026-08-22T07:00:00.000Z");
  let fail = true;
  let calls = 0;
  const events = {
    consumeChatEvent() {
      calls += 1;
      if (fail) throw new Error("synthetic projection failure");
    }
  };
  let tick = 0;
  const dispatcher = createEventDispatcher({ db, events, nowIso: () => `2026-08-22T07:00:${String(tick++).padStart(2,"0")}.000Z` });

  for (let attempt = 1; attempt <= 4; attempt += 1) {
    const result = dispatcher.processBatch();
    assert.equal(result.failed, 0);
    const row = db.prepare("SELECT status,attempts,processed_at,failed_at FROM driver_event_outbox WHERE id=1").get();
    assert.equal(row.status, "PENDING");
    assert.equal(Number(row.attempts), attempt);
    assert.equal(row.processed_at, null);
    assert.equal(row.failed_at, null);
  }
  const fifth = dispatcher.processBatch();
  assert.equal(fifth.failed, 1);
  let row = db.prepare("SELECT status,attempts,last_error,processed_at,failed_at FROM driver_event_outbox WHERE id=1").get();
  assert.equal(row.status, "FAILED");
  assert.equal(Number(row.attempts), 5);
  assert.match(row.last_error, /synthetic projection failure/);
  assert.equal(row.processed_at, null);
  assert.ok(row.failed_at);
  assert.equal(dispatcher.failedCount(), 1);
  assert.equal(dispatcher.listFailed()[0].id, 1);

  dispatcher.processBatch();
  assert.equal(calls, 5, "FAILED rows must not be retried automatically");

  assert.deepEqual(dispatcher.retryFailed(1), { ok: true, id: 1 });
  row = db.prepare("SELECT status,attempts,last_error,failed_at FROM driver_event_outbox WHERE id=1").get();
  assert.equal(row.status, "PENDING");
  assert.equal(Number(row.attempts), 0);
  assert.equal(row.last_error, null);
  assert.equal(row.failed_at, null);

  fail = false;
  const success = dispatcher.processBatch();
  assert.equal(success.processed, 1);
  row = db.prepare("SELECT status,attempts,last_error,processed_at FROM driver_event_outbox WHERE id=1").get();
  assert.equal(row.status, "PROCESSED");
  assert.equal(Number(row.attempts), 1);
  assert.equal(row.last_error, null);
  assert.ok(row.processed_at);
  assert.equal(dispatcher.failedCount(), 0);
  db.close();
});

test("dead-letter retention is longer than normal processed retention", () => {
  const db = createOutboxDb();
  db.prepare("INSERT INTO driver_event_outbox(event_kind,source_ref,created_at,processed_at,status) VALUES('CHAT_MESSAGE','1',?,?, 'PROCESSED')")
    .run("2026-07-01T00:00:00.000Z", "2026-08-10T00:00:00.000Z");
  db.prepare("INSERT INTO driver_event_outbox(event_kind,source_ref,created_at,status,failed_at) VALUES('CHAT_MESSAGE','2',?,'FAILED',?)")
    .run("2026-07-01T00:00:00.000Z", "2026-08-10T00:00:00.000Z");
  db.prepare("INSERT INTO driver_event_outbox(event_kind,source_ref,created_at,status,failed_at) VALUES('CHAT_MESSAGE','3',?,'FAILED',?)")
    .run("2026-06-01T00:00:00.000Z", "2026-07-01T00:00:00.000Z");
  const dispatcher = createEventDispatcher({ db, events: {}, nowIso: () => "2026-08-22T08:00:00.000Z" });
  assert.equal(dispatcher.cleanupProcessed(), 2);
  const remaining = db.prepare("SELECT source_ref,status FROM driver_event_outbox ORDER BY id").all();
  assert.deepEqual(remaining, [{ source_ref: "2", status: "FAILED" }]);
  db.close();
});

test("dead-letter diagnostics are Owner-only and retry requires CSRF", async () => {
  const calls = [];
  const dispatcher = {
    listFailed(limit) { calls.push(["list", limit]); return [{ id: 7, event_kind: "CHAT_MESSAGE" }]; },
    failedCount() { return 1; },
    retryFailed(id) { calls.push(["retry", id]); return { ok: true, id }; }
  };
  const events = { dispatcher, repo: {} };
  let session = { user: { id: 1, role: "User" }, csrfToken: "token" };
  let output = null;
  const json = (_res, status, body) => { output = { status, body }; };
  const handler = createEventRoutes({
    events,
    push: {},
    json,
    requireSession: () => session,
    requireCsrf: (_req, _res, current) => current?.csrfToken === "token",
    checkRate: () => true,
    nowIso: () => "2026-08-22T08:00:00.000Z",
    audit: () => {}
  });
  const res = {};

  await handler({ method: "GET" }, res, new URL("http://local/api/driver/events/admin/outbox-failures?limit=25"));
  assert.equal(output.status, 403);
  assert.deepEqual(calls, []);

  session = { user: { id: 2, role: "Owner" }, csrfToken: "token" };
  await handler({ method: "GET" }, res, new URL("http://local/api/driver/events/admin/outbox-failures?limit=25"));
  assert.equal(output.status, 200);
  assert.equal(output.body.count, 1);
  assert.deepEqual(calls[0], ["list", "25"]);

  await handler({ method: "POST" }, res, new URL("http://local/api/driver/events/admin/outbox-failures/7/retry"), {});
  assert.equal(output.status, 200);
  assert.equal(output.body.queued, true);
  assert.deepEqual(calls[1], ["retry", 7]);
});
