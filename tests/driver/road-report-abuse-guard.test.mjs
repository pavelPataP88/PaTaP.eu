import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import repositoryModule from "../../server/road-reports/repository.js";
import guardRoutesModule from "../../server/road-reports/guard-routes.js";

const {
  createRoadReportRepository,
  INDEPENDENT_CONFIRMATIONS_REQUIRED,
  FAST_DISPUTE_MINUTES,
  RESTRICTION_SCORE,
  RESTRICTION_HOURS
} = repositoryModule;
const { createRoadReportGuardRoutes } = guardRoutesModule;

function createDb() {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE users(id INTEGER PRIMARY KEY, role TEXT);
    INSERT INTO users(id, role) VALUES(1, 'User'), (2, 'User'), (3, 'User'), (4, 'User'), (9, 'Owner');
  `);
  return db;
}

function createReport(reports, authorId = 1) {
  return reports.create(authorId, {
    type: "OBSTACLE",
    lane: null,
    latitude: 50.2649,
    longitude: 19.0238
  });
}

test("road report schema upgrades v1 additively without losing reports or votes", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE users(id INTEGER PRIMARY KEY);
      INSERT INTO users(id) VALUES(1),(2);
      CREATE TABLE road_report_schema_meta(singleton INTEGER PRIMARY KEY, version INTEGER NOT NULL, updated_at TEXT NOT NULL);
      INSERT INTO road_report_schema_meta VALUES(1, 1, '2026-08-18T00:00:00.000Z');
      CREATE TABLE road_reports(
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        author_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        type TEXT NOT NULL,
        lane TEXT,
        latitude REAL NOT NULL,
        longitude REAL NOT NULL,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        closed_at TEXT
      );
      CREATE TABLE road_report_votes(
        report_id INTEGER NOT NULL REFERENCES road_reports(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        status TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY(report_id, user_id)
      );
      INSERT INTO road_reports(author_id,type,lane,latitude,longitude,created_at,expires_at,closed_at)
      VALUES(1,'OBSTACLE',NULL,50,19,'2026-08-18T12:00:00.000Z','2026-08-18T12:45:00.000Z',NULL);
      INSERT INTO road_report_votes(report_id,user_id,status,updated_at)
      VALUES(1,2,'ACTIVE','2026-08-18T12:01:00.000Z');
    `);
    const reports = createRoadReportRepository(db, { nowIso: () => "2026-08-18T12:02:00.000Z" });
    assert.equal(db.prepare("SELECT version FROM road_report_schema_meta WHERE singleton=1").get().version, 2);
    const columns = new Set(db.prepare("PRAGMA table_info(road_reports)").all().map((item) => item.name));
    assert.ok(columns.has("peer_supported_at"));
    assert.ok(columns.has("abuse_counted_at"));
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM road_report_votes").get().n, 1);
    assert.equal(reports.list()[0].trust.state, "SUPPORTED");
  } finally {
    db.close();
  }
});

test("report trust is based on independent peers and a previously confirmed report is not punished when it later clears", () => {
  const db = createDb();
  let clock = Date.parse("2026-08-18T12:00:00.000Z");
  const reports = createRoadReportRepository(db, { nowIso: () => new Date(clock).toISOString() });
  try {
    assert.equal(INDEPENDENT_CONFIRMATIONS_REQUIRED, 2);
    const report = createReport(reports);
    assert.equal(report.trust.state, "UNCONFIRMED");
    assert.equal(reports.confirm(2, report.id, "ACTIVE").report.trust.state, "SUPPORTED");
    assert.equal(reports.confirm(3, report.id, "ACTIVE").report.trust.state, "CONFIRMED");

    clock += 60_000;
    assert.equal(reports.confirm(2, report.id, "GONE").closed, false);
    const closed = reports.confirm(3, report.id, "GONE");
    assert.equal(closed.closed, true);
    assert.equal(closed.report.trust.state, "DISPUTED");
    assert.equal(reports.creationGuard(1).abuseScore, 0);
    assert.equal(reports.creationGuard(1).allowed, true);
  } finally {
    db.close();
  }
});

test("repeated fast independent disputes create a decaying temporary create-only restriction", () => {
  const db = createDb();
  let clock = Date.parse("2026-08-18T12:00:00.000Z");
  const nowIso = () => new Date(clock).toISOString();
  const reports = createRoadReportRepository(db, { nowIso });
  try {
    assert.equal(FAST_DISPUTE_MINUTES, 10);
    assert.equal(RESTRICTION_SCORE, 3);
    assert.equal(RESTRICTION_HOURS, 6);

    for (let index = 0; index < 3; index += 1) {
      const report = createReport(reports);
      assert.equal(reports.confirm(2, report.id, "GONE").closed, false);
      const closed = reports.confirm(3, report.id, "GONE");
      assert.equal(closed.closed, true);
      assert.equal(closed.report.trust.state, "DISPUTED");
      assert.equal("abuseRecorded" in closed, false);
      clock += 60_000;
    }

    const restricted = reports.creationGuard(1);
    assert.equal(restricted.allowed, false);
    assert.equal(restricted.abuseScore, 3);
    assert.ok(restricted.retryAfterSeconds > 0);
    assert.ok(restricted.restrictedUntil);

    clock += (RESTRICTION_HOURS * 60 + 1) * 60_000;
    assert.equal(reports.creationGuard(1).allowed, true);
    assert.equal(reports.creationGuard(1).abuseScore, 3);

    clock += 8 * 24 * 60 * 60 * 1000;
    assert.equal(reports.creationGuard(1).abuseScore, 2);
  } finally {
    db.close();
  }
});

test("guard routes restrict only creation and keep diagnostics admin-only and location-free", async () => {
  const db = createDb();
  const now = "2026-08-18T12:00:00.000Z";
  const reports = createRoadReportRepository(db, { nowIso: () => now });
  try {
    for (let index = 0; index < 3; index += 1) {
      const report = createReport(reports);
      reports.confirm(2, report.id, "GONE");
      reports.confirm(3, report.id, "GONE");
    }

    const responses = [];
    const audits = [];
    const options = {
      db,
      roadReports: reports,
      nowIso: () => now,
      requireSession(req) { return req.session || null; },
      audit(_req, action, payload) { audits.push({ action, payload }); },
      json(_res, status, payload, headers) { responses.push({ status, payload, headers }); }
    };
    const handle = createRoadReportGuardRoutes(options);

    let handled = await handle({ method: "POST", session: { user: { id: 1, role: "User" } } }, {}, new URL("https://driver.test/api/driver/road-reports"));
    assert.equal(handled, true);
    assert.equal(responses.at(-1).status, 429);
    assert.equal(responses.at(-1).payload.error, "road_report_temporarily_restricted");
    assert.ok(Number(responses.at(-1).headers["Retry-After"]) > 0);
    assert.equal(audits.at(-1).action, "road_report_creation_restricted");

    handled = await handle({ method: "POST", session: { user: { id: 4, role: "User" } } }, {}, new URL("https://driver.test/api/driver/road-reports"));
    assert.equal(handled, false);

    handled = await handle({ method: "GET", session: { user: { id: 4, role: "User" } } }, {}, new URL("https://driver.test/api/driver/admin/road-reports"));
    assert.equal(handled, true);
    assert.equal(responses.at(-1).status, 403);

    handled = await handle({ method: "GET", session: { user: { id: 9, role: "Owner" } } }, {}, new URL("https://driver.test/api/driver/admin/road-reports"));
    assert.equal(handled, true);
    assert.equal(responses.at(-1).status, 200);
    const diagnostics = responses.at(-1).payload.roadReports;
    assert.equal(diagnostics.publicUserRating, false);
    assert.equal(diagnostics.locationHistoryStored, false);
    assert.equal(diagnostics.restrictedUsers, 1);
    const serialized = JSON.stringify(diagnostics);
    assert.doesNotMatch(serialized, /latitude|longitude|reportId/i);

    handled = await handle({ method: "POST", session: { user: { id: 9, role: "Owner" } } }, {}, new URL("https://driver.test/api/driver/admin/road-reports"));
    assert.equal(handled, true);
    assert.equal(responses.at(-1).status, 405);
  } finally {
    db.close();
  }
});
