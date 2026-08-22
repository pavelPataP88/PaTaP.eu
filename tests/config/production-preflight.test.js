const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const {
  inspectDatabase,
  createVerifiedBackup,
  inspectVapidKeyMaterial,
  captureRoadReportsSnapshot,
  evaluatePreflight
} = require("../../scripts/production-preflight");

function tempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "patap-preflight-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function fixtureDb(file) {
  const db = new DatabaseSync(file);
  db.exec(`
    CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
    INSERT INTO schema_migrations(version,applied_at) VALUES(1,'2026-08-22T00:00:00.000Z'),(2,'2026-08-22T00:00:00.000Z');
    CREATE TABLE radio_transmissions(id INTEGER PRIMARY KEY,state TEXT NOT NULL,expires_at TEXT NOT NULL,byte_length INTEGER NOT NULL);
    INSERT INTO radio_transmissions(id,state,expires_at,byte_length) VALUES
      (1,'COMMITTED','2026-08-22T06:00:00.000Z',1200),(2,'COMMITTED','2026-08-22T08:00:00.000Z',3400),(3,'PENDING','2026-08-22T05:00:00.000Z',5000);
    CREATE TABLE driver_push_subscriptions(id INTEGER PRIMARY KEY, revoked_at TEXT);
    INSERT INTO driver_push_subscriptions(id,revoked_at) VALUES(1,NULL),(2,'2026-08-22T01:00:00.000Z');
    CREATE TABLE road_reports(id INTEGER PRIMARY KEY, expires_at TEXT NOT NULL, closed_at TEXT);
    INSERT INTO road_reports(id,expires_at,closed_at) VALUES
      (1,'2026-08-22T08:00:00.000Z',NULL),(2,'2026-08-22T06:00:00.000Z',NULL),(3,'2026-08-22T08:00:00.000Z','2026-08-22T06:30:00.000Z');
  `);
  db.close();
}

function safeDatabaseState(overrides = {}) {
  return {
    integrity: { ok: true },
    authMigrations: { present: true, contiguous: true, supported: true },
    push: { activeSubscriptions: 0 },
    radioRetention: { expiredCommitted: 0 },
    ...overrides
  };
}

test("database inspection is read-only and reports the deployment-sensitive state", (t) => {
  const dir = tempDir(t);
  const file = path.join(dir, "auth.sqlite");
  fixtureDb(file);
  const before = fs.statSync(file).size;
  const result = inspectDatabase(file, "2026-08-22T07:00:00.000Z");
  const after = fs.statSync(file).size;
  assert.equal(result.integrity.ok, true);
  assert.deepEqual(result.authMigrations, { present: true, count: 2, max: 2, contiguous: true, supported: true });
  assert.deepEqual(result.radioRetention, { present: true, expiredCommitted: 1, expiredBytes: 1200, totalCommitted: 2 });
  assert.deepEqual(result.push, { present: true, activeSubscriptions: 1 });
  assert.deepEqual(result.roadReports, { present: true, activeRows: 1, totalRows: 3 });
  assert.equal(after, before);
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    assert.equal(Number(db.prepare("SELECT COUNT(*) AS n FROM radio_transmissions").get().n), 3);
    assert.equal(Number(db.prepare("SELECT COUNT(*) AS n FROM road_reports").get().n), 3);
  } finally { db.close(); }
});

test("verified backup is an independent integrity-checked copy and does not mutate source", async (t) => {
  const dir = tempDir(t);
  const file = path.join(dir, "auth.sqlite");
  fixtureDb(file);
  const info = await createVerifiedBackup(file, path.join(dir, "preflight"), "fixture");
  assert.equal(info.integrity.ok, true);
  assert.ok(info.bytes > 0);
  assert.match(info.sha256, /^[a-f0-9]{64}$/);
  assert.equal(fs.existsSync(info.path), true);
  const source = new DatabaseSync(file, { readOnly: true });
  const copy = new DatabaseSync(info.path, { readOnly: true });
  try {
    assert.equal(Number(source.prepare("SELECT COUNT(*) AS n FROM radio_transmissions").get().n), 3);
    assert.equal(Number(copy.prepare("SELECT COUNT(*) AS n FROM radio_transmissions").get().n), 3);
  } finally { source.close(); copy.close(); }
});

test("live road snapshot preserves the old in-memory payload and blocks restart while reports are active", async (t) => {
  const dir = tempDir(t);
  const target = path.join(dir, "road-reports.json");
  const fetchImpl = async (url) => {
    if (String(url).endsWith("/api/health")) return { ok: true, status: 200 };
    return { ok: true, status: 200, async json() { return { reports: [{ id: 7, type: "ACCIDENT", lane: "LEFT", latitude: 50, longitude: 19, createdAt: "2026-08-22T06:30:00.000Z", expiresAt: "2026-08-22T07:30:00.000Z", confirmations: { active: 1, gone: 0 } }] }; } };
  };
  const snapshot = await captureRoadReportsSnapshot({ baseUrl: "http://127.0.0.1:8091", target, fetchImpl, capturedAt: "2026-08-22T07:00:00.000Z" });
  assert.equal(snapshot.status, "PASS");
  assert.equal(snapshot.activeCount, 1);
  assert.equal(JSON.parse(fs.readFileSync(target, "utf8")).reports[0].id, 7);
  const decision = evaluatePreflight({ database: safeDatabaseState(), backupInfo: { integrity: { ok: true } }, roadSnapshot: snapshot, vapid: { exists: false, valid: false } });
  assert.equal(decision.ready, false);
  assert.deepEqual(decision.blockers, ["active_in_memory_road_reports:1"]);
});

test("backend must still be inspectable before first production apply", () => {
  const decision = evaluatePreflight({
    database: safeDatabaseState(),
    backupInfo: { integrity: { ok: true } },
    roadSnapshot: { status: "SKIP_BACKEND_UNAVAILABLE", activeCount: 0 },
    vapid: { exists: false, valid: false }
  });
  assert.equal(decision.ready, false);
  assert.deepEqual(decision.blockers, ["backend_unavailable_no_memory_snapshot"]);
});

test("active push subscriptions require preserved valid VAPID material but secret keys never enter the report", async (t) => {
  const dir = tempDir(t);
  const vapidPath = path.join(dir, "vapid.json");
  fs.writeFileSync(vapidPath, JSON.stringify({ publicKey: "public-value", privateJwk: { d: "secret-d", x: "x", y: "y" }, createdAt: "2026-08-22T00:00:00.000Z" }), "utf8");
  const vapid = await inspectVapidKeyMaterial(vapidPath);
  assert.equal(vapid.exists, true);
  assert.equal(vapid.valid, true);
  assert.match(vapid.sha256, /^[a-f0-9]{64}$/);
  assert.equal(Object.hasOwn(vapid, "privateJwk"), false);
  assert.equal(JSON.stringify(vapid).includes("secret-d"), false);

  const blocked = evaluatePreflight({ database: safeDatabaseState({ push: { activeSubscriptions: 2 } }), backupInfo: { integrity: { ok: true } }, roadSnapshot: { status: "PASS", activeCount: 0 }, vapid: { exists: false, valid: false } });
  assert.equal(blocked.ready, false);
  assert.ok(blocked.blockers.includes("active_push_subscriptions_without_valid_vapid_keys"));

  const ready = evaluatePreflight({ database: safeDatabaseState({ push: { activeSubscriptions: 2 }, radioRetention: { expiredCommitted: 4 } }), backupInfo: { integrity: { ok: true } }, roadSnapshot: { status: "PASS", activeCount: 0 }, vapid });
  assert.equal(ready.ready, true);
  assert.deepEqual(ready.warnings, ["radio_retention_pending:4"]);
});

test("production command is runtime-gated and Windows wrapper cannot restart services", () => {
  const root = path.resolve(__dirname, "../..");
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  const wrapper = fs.readFileSync(path.join(root, "preflight-production.cmd"), "utf8");
  const script = fs.readFileSync(path.join(root, "scripts", "production-preflight.js"), "utf8");
  assert.equal(pkg.scripts["production:preflight"], "npm run runtime:check && node scripts/production-preflight.js");
  assert.match(wrapper, /npm run production:preflight/);
  assert.doesNotMatch(wrapper, /start-patap-stack|start-backend|restart/i);
  assert.match(script, /new DatabaseSync\(dbPath, \{ readOnly: true \}\)/);
  assert.doesNotMatch(script, /require\(["']\.\.\/server\/auth\/db["']\)/);
});
