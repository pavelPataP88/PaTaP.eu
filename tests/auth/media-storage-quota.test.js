const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const { createMediaQuota } = require("../../server/storage/quota");
const { createStorageRoutes } = require("../../server/storage/routes");

function fixture() {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT NOT NULL);
    CREATE TABLE chat_uploads (
      id TEXT PRIMARY KEY, user_id INTEGER NOT NULL, byte_length INTEGER NOT NULL,
      storage_key TEXT NOT NULL, state TEXT NOT NULL, created_at TEXT NOT NULL, expires_at TEXT NOT NULL
    );
    CREATE TABLE chat_message_attachments (id INTEGER PRIMARY KEY, storage_key TEXT NOT NULL);
    CREATE TABLE radio_transmissions (
      id INTEGER PRIMARY KEY, sender_id INTEGER NOT NULL, byte_length INTEGER NOT NULL,
      storage_key TEXT NOT NULL, state TEXT NOT NULL, created_at TEXT NOT NULL, expires_at TEXT NOT NULL
    );
    CREATE TABLE parking_photos (
      id INTEGER PRIMARY KEY, uploader_id INTEGER, byte_length INTEGER NOT NULL,
      storage_key TEXT NOT NULL, state TEXT NOT NULL, created_at TEXT NOT NULL
    );
  `);
  db.prepare("INSERT INTO users(id,username) VALUES(1,'quota-user')").run();
  const now = "2026-08-22T12:00:00.000Z";
  const future = "2026-08-22T13:00:00.000Z";
  const past = "2026-08-22T11:00:00.000Z";
  db.prepare("INSERT INTO chat_uploads VALUES(?,?,?,?,?,?,?)").run("chat-ready", 1, 100, "chat-live", "ATTACHED", now, future);
  db.prepare("INSERT INTO chat_uploads VALUES(?,?,?,?,?,?,?)").run("chat-pending", 1, 200, "chat-pending", "PENDING", now, future);
  db.prepare("INSERT INTO chat_uploads VALUES(?,?,?,?,?,?,?)").run("chat-expired", 1, 900, "chat-expired", "PENDING", now, past);
  db.prepare("INSERT INTO radio_transmissions VALUES(?,?,?,?,?,?,?)").run(1, 1, 300, "radio-live", "COMMITTED", now, future);
  db.prepare("INSERT INTO radio_transmissions VALUES(?,?,?,?,?,?,?)").run(2, 1, 0, "radio-pending", "UPLOADING", now, future);
  db.prepare("INSERT INTO radio_transmissions VALUES(?,?,?,?,?,?,?)").run(3, 1, 0, "radio-expired", "UPLOADING", now, past);
  db.prepare("INSERT INTO parking_photos VALUES(?,?,?,?,?,?)").run(1, 1, 400, "parking-live", "VISIBLE", now);
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "patap-media-quota-"));
  for (const domain of ["chat", "radio", "parking"]) fs.mkdirSync(path.join(dataDir, domain), { recursive: true });
  fs.writeFileSync(path.join(dataDir, "chat", "chat-live"), Buffer.alloc(100));
  fs.writeFileSync(path.join(dataDir, "chat", "orphan.bin"), Buffer.alloc(20));
  fs.writeFileSync(path.join(dataDir, "parking", "parking-live"), Buffer.alloc(400));
  return { db, dataDir, now: () => new Date(now), cleanup() { db.close(); fs.rmSync(dataDir, { recursive: true, force: true }); } };
}

function generousLimits(overrides = {}) {
  return {
    userDailyBytes: 1_000_000,
    userStoredBytes: 1_000_000,
    globalStoredBytes: 1_000_000,
    minFreeBytes: 0,
    minFreeRatio: 0,
    radioReservationBytes: 500,
    domainStoredBytes: { chat: 1_000_000, radio: 1_000_000, parking: 1_000_000 },
    ...overrides,
    domainStoredBytes: { chat: 1_000_000, radio: 1_000_000, parking: 1_000_000, ...(overrides.domainStoredBytes || {}) }
  };
}

function healthyDisk() {
  return { available: true, totalBytes: 10_000_000, availableBytes: 9_000_000, minimumFreeBytes: 100, healthy: true };
}

test("media quota counts stored bytes and active reservations without counting expired uploads", () => {
  const state = fixture();
  try {
    const quota = createMediaQuota({ db: state.db, dataDir: state.dataDir, now: state.now, limits: generousLimits(), diskProvider: healthyDisk });
    const usage = quota.usage(1);
    assert.equal(usage.domains.chat.actualBytes, 100);
    assert.equal(usage.domains.chat.reservedBytes, 200);
    assert.equal(usage.domains.radio.actualBytes, 300);
    assert.equal(usage.domains.radio.reservedBytes, 500);
    assert.equal(usage.domains.parking.actualBytes, 400);
    assert.equal(usage.actualBytes, 800);
    assert.equal(usage.reservedBytes, 700);
    assert.equal(usage.accountedBytes, 1500);
    assert.equal(usage.dailyBytes, 1500);
  } finally { state.cleanup(); }
});

test("media quota rejects daily, user, domain, global and low-disk overflow with stable domain errors", () => {
  const state = fixture();
  try {
    const cases = [
      [generousLimits({ userDailyBytes: 1600 }), "chat", 101, "media_daily_quota_exceeded", 429],
      [generousLimits({ userStoredBytes: 1550 }), "chat", 51, "media_user_storage_quota_exceeded", 507],
      [generousLimits({ domainStoredBytes: { chat: 350 } }), "chat", 51, "media_domain_storage_quota_exceeded", 507],
      [generousLimits({ globalStoredBytes: 1550 }), "parking", 51, "media_global_storage_quota_exceeded", 507]
    ];
    for (const [limits, domain, requested, error, status] of cases) {
      const quota = createMediaQuota({ db: state.db, dataDir: state.dataDir, now: state.now, limits, diskProvider: healthyDisk });
      const result = quota.checkUpload(1, domain, requested);
      assert.equal(result.ok, false);
      assert.equal(result.error, error);
      assert.equal(result.status, status);
    }

    const lowDisk = createMediaQuota({
      db: state.db,
      dataDir: state.dataDir,
      now: state.now,
      limits: generousLimits(),
      diskProvider: () => ({ available: true, totalBytes: 1000, availableBytes: 120, minimumFreeBytes: 100, healthy: true })
    }).checkUpload(1, "chat", 30);
    assert.equal(lowDisk.ok, false);
    assert.equal(lowDisk.error, "media_low_disk");
    assert.equal(lowDisk.status, 507);
  } finally { state.cleanup(); }
});

test("orphan diagnostics are read-only and report unreferenced and missing media", () => {
  const state = fixture();
  try {
    const quota = createMediaQuota({ db: state.db, dataDir: state.dataDir, now: state.now, limits: generousLimits(), diskProvider: healthyDisk });
    const scan = quota.scanOrphans();
    assert.equal(scan.chat.unreferencedFiles, 1);
    assert.equal(scan.chat.unreferencedBytes, 20);
    assert.equal(scan.chat.missingReferencedFiles, 0);
    assert.equal(scan.radio.missingReferencedFiles, 1);
    assert.equal(scan.parking.missingReferencedFiles, 0);
    assert.equal(fs.existsSync(path.join(state.dataDir, "chat", "orphan.bin")), true);
    assert.equal(state.db.prepare("SELECT COUNT(*) AS n FROM chat_uploads").get().n, 3);
  } finally { state.cleanup(); }
});

test("storage diagnostics route is read-only and limited to Owner or Administrator", async () => {
  const calls = [];
  const audits = [];
  const options = {
    db: {},
    mediaQuota: { adminStats: () => ({ destructiveCleanupEnabled: false, usage: { accountedBytes: 123 } }) },
    requireSession: () => ({ user: { id: 7, role: options.role } }),
    audit: (...args) => audits.push(args),
    json: (_res, status, body, headers = {}) => calls.push({ status, body, headers })
  };
  const route = createStorageRoutes(options);

  options.role = "User";
  assert.equal(await route({ method: "GET" }, {}, new URL("http://local/api/driver/admin/storage")), true);
  assert.equal(calls.at(-1).status, 403);
  assert.equal(audits.length, 1);

  options.role = "Administrator";
  assert.equal(await route({ method: "GET" }, {}, new URL("http://local/api/driver/admin/storage")), true);
  assert.equal(calls.at(-1).status, 200);
  assert.equal(calls.at(-1).body.storage.destructiveCleanupEnabled, false);

  options.role = "Owner";
  assert.equal(await route({ method: "POST" }, {}, new URL("http://local/api/driver/admin/storage")), true);
  assert.equal(calls.at(-1).status, 405);
  assert.equal(calls.at(-1).headers.Allow, "GET");
});
