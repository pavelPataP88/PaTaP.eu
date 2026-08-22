const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { DatabaseSync, backup } = require("node:sqlite");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_DB_PATH = process.env.PATAP_DB_PATH || path.join(ROOT, "data", "auth", "patap-auth.sqlite");
const DEFAULT_BACKEND_BASE_URL = process.env.PATAP_PREFLIGHT_BACKEND_URL || "http://127.0.0.1:8091";
const AUTH_SCHEMA_VERSION = 12;

function stamp(value = new Date()) {
  return value.toISOString().replace(/[:.]/g, "-");
}

function firstValue(row) {
  return row && Object.values(row)[0];
}

function tableExists(db, name) {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name=?").get(name));
}

function tableColumns(db, name) {
  if (!tableExists(db, name)) return new Set();
  return new Set(db.prepare(`PRAGMA table_info(${name})`).all().map((row) => String(row.name)));
}

function integrityCheck(db) {
  const messages = db.prepare("PRAGMA integrity_check").all().map((row) => String(firstValue(row)));
  return { ok: messages.length === 1 && messages[0].toLowerCase() === "ok", messages };
}

function inspectDatabase(dbPath = DEFAULT_DB_PATH, nowIso = new Date().toISOString()) {
  if (!fs.existsSync(dbPath)) throw new Error(`production_database_not_found:${dbPath}`);
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const integrity = integrityCheck(db);

    let authMigrations = { present: false, count: 0, max: 0, contiguous: true, supported: true };
    if (tableExists(db, "schema_migrations")) {
      const versions = db.prepare("SELECT version FROM schema_migrations ORDER BY version").all().map((row) => Number(row.version));
      const max = versions.length ? Math.max(...versions) : 0;
      const contiguous = versions.every((version, index) => version === index + 1);
      authMigrations = {
        present: true,
        count: versions.length,
        max,
        contiguous,
        supported: max <= AUTH_SCHEMA_VERSION
      };
    }

    let radioRetention = { present: false, expiredCommitted: 0, expiredBytes: 0, totalCommitted: 0 };
    const radioColumns = tableColumns(db, "radio_transmissions");
    if (["state", "expires_at", "byte_length"].every((column) => radioColumns.has(column))) {
      const expired = db.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(byte_length),0) AS bytes
        FROM radio_transmissions WHERE state='COMMITTED' AND expires_at <= ?`).get(nowIso);
      const total = db.prepare("SELECT COUNT(*) AS n FROM radio_transmissions WHERE state='COMMITTED'").get();
      radioRetention = {
        present: true,
        expiredCommitted: Number(expired.n || 0),
        expiredBytes: Number(expired.bytes || 0),
        totalCommitted: Number(total.n || 0)
      };
    }

    let push = { present: false, activeSubscriptions: 0 };
    const pushColumns = tableColumns(db, "driver_push_subscriptions");
    if (pushColumns.has("revoked_at")) {
      const row = db.prepare("SELECT COUNT(*) AS n FROM driver_push_subscriptions WHERE revoked_at IS NULL").get();
      push = { present: true, activeSubscriptions: Number(row.n || 0) };
    }

    let roadReports = { present: false, activeRows: 0, totalRows: 0 };
    const roadColumns = tableColumns(db, "road_reports");
    if (["expires_at", "closed_at"].every((column) => roadColumns.has(column))) {
      const active = db.prepare("SELECT COUNT(*) AS n FROM road_reports WHERE closed_at IS NULL AND expires_at > ?").get(nowIso);
      const total = db.prepare("SELECT COUNT(*) AS n FROM road_reports").get();
      roadReports = { present: true, activeRows: Number(active.n || 0), totalRows: Number(total.n || 0) };
    }

    return { integrity, authMigrations, radioRetention, push, roadReports };
  } finally {
    db.close();
  }
}

async function sha256File(filePath) {
  const hash = crypto.createHash("sha256");
  await new Promise((resolve, reject) => {
    const stream = fs.createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", resolve);
  });
  return hash.digest("hex");
}

async function createVerifiedBackup(dbPath = DEFAULT_DB_PATH, backupDir, label = stamp()) {
  if (!backupDir) throw new Error("production_preflight_backup_dir_required");
  fs.mkdirSync(backupDir, { recursive: true });
  const target = path.join(backupDir, `patap-auth-preflight-${label}.sqlite`);
  const source = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const sourceIntegrity = integrityCheck(source);
    if (!sourceIntegrity.ok) throw new Error(`source_database_integrity_failed:${sourceIntegrity.messages.join("|")}`);
    await backup(source, target);
  } finally {
    source.close();
  }

  const copy = new DatabaseSync(target, { readOnly: true });
  let backupIntegrity;
  try {
    backupIntegrity = integrityCheck(copy);
  } finally {
    copy.close();
  }
  if (!backupIntegrity.ok) throw new Error(`backup_database_integrity_failed:${backupIntegrity.messages.join("|")}`);

  const stat = fs.statSync(target);
  return {
    path: target,
    bytes: Number(stat.size),
    sha256: await sha256File(target),
    integrity: backupIntegrity
  };
}

async function inspectVapidKeyMaterial(filePath) {
  if (!fs.existsSync(filePath)) return { exists: false, valid: false, sha256: null, bytes: 0 };
  const raw = fs.readFileSync(filePath, "utf8");
  let parsed = null;
  try { parsed = JSON.parse(raw); } catch {}
  const valid = Boolean(
    parsed?.publicKey && parsed?.privateJwk?.d && parsed?.privateJwk?.x && parsed?.privateJwk?.y
  );
  return {
    exists: true,
    valid,
    sha256: crypto.createHash("sha256").update(raw).digest("hex"),
    bytes: Buffer.byteLength(raw),
    createdAt: typeof parsed?.createdAt === "string" ? parsed.createdAt : null
  };
}

async function fetchWithTimeout(url, { fetchImpl = globalThis.fetch, timeoutMs = 5000 } = {}) {
  if (typeof fetchImpl !== "function") throw new Error("fetch_unavailable");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  timer.unref?.();
  try {
    return await fetchImpl(url, { signal: controller.signal, headers: { accept: "application/json" } });
  } finally {
    clearTimeout(timer);
  }
}

async function captureRoadReportsSnapshot({
  baseUrl = DEFAULT_BACKEND_BASE_URL,
  target,
  fetchImpl = globalThis.fetch,
  timeoutMs = 5000,
  capturedAt = new Date().toISOString()
} = {}) {
  if (!target) throw new Error("road_report_snapshot_target_required");
  const healthUrl = new URL("/api/health", baseUrl).toString();
  const reportsUrl = new URL("/api/driver/road-reports", baseUrl).toString();

  let healthOk = false;
  try {
    const health = await fetchWithTimeout(healthUrl, { fetchImpl, timeoutMs });
    healthOk = Boolean(health?.ok);
  } catch {}

  try {
    const response = await fetchWithTimeout(reportsUrl, { fetchImpl, timeoutMs });
    if (!response?.ok) throw new Error(`road_report_http_${Number(response?.status || 0)}`);
    const body = await response.json();
    if (!Array.isArray(body?.reports)) throw new Error("road_report_snapshot_invalid_payload");
    const snapshot = { capturedAt, source: reportsUrl, count: body.reports.length, reports: body.reports };
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, JSON.stringify(snapshot, null, 2), "utf8");
    return { status: "PASS", activeCount: body.reports.length, path: target, healthOk };
  } catch (error) {
    if (healthOk) {
      return { status: "FAIL", activeCount: null, path: null, healthOk, reason: String(error?.message || error) };
    }
    return {
      status: "SKIP_BACKEND_UNAVAILABLE",
      activeCount: 0,
      path: null,
      healthOk: false,
      reason: String(error?.message || error)
    };
  }
}

function evaluatePreflight({ database, backupInfo, roadSnapshot, vapid }) {
  const blockers = [];
  const warnings = [];
  if (!database?.integrity?.ok) blockers.push("source_database_integrity_failed");
  if (database?.authMigrations?.present && !database.authMigrations.contiguous) blockers.push("auth_migration_history_gap");
  if (database?.authMigrations?.present && !database.authMigrations.supported) blockers.push("auth_schema_newer_than_candidate");
  if (!backupInfo?.integrity?.ok) blockers.push("backup_integrity_failed");
  if (roadSnapshot?.status === "FAIL") blockers.push("live_road_report_snapshot_failed");
  if (roadSnapshot?.status === "SKIP_BACKEND_UNAVAILABLE") blockers.push("backend_unavailable_no_memory_snapshot");
  if (roadSnapshot?.status === "PASS" && Number(roadSnapshot.activeCount) > 0) {
    blockers.push(`active_in_memory_road_reports:${Number(roadSnapshot.activeCount)}`);
  }
  if (Number(database?.push?.activeSubscriptions || 0) > 0 && (!vapid?.exists || !vapid?.valid)) {
    blockers.push("active_push_subscriptions_without_valid_vapid_keys");
  }
  if (Number(database?.radioRetention?.expiredCommitted || 0) > 0) {
    warnings.push(`radio_retention_pending:${Number(database.radioRetention.expiredCommitted)}`);
  }
  return { ready: blockers.length === 0, blockers, warnings };
}

async function runPreflight({
  dbPath = DEFAULT_DB_PATH,
  backendBaseUrl = DEFAULT_BACKEND_BASE_URL,
  outputDir = process.env.PATAP_PREFLIGHT_DIR || path.join(path.dirname(dbPath), "preflight"),
  now = new Date(),
  fetchImpl = globalThis.fetch
} = {}) {
  const nowIso = now.toISOString();
  const label = stamp(now);
  fs.mkdirSync(outputDir, { recursive: true });

  const roadSnapshot = await captureRoadReportsSnapshot({
    baseUrl: backendBaseUrl,
    target: path.join(outputDir, `road-reports-${label}.json`),
    fetchImpl,
    capturedAt: nowIso
  });
  const database = inspectDatabase(dbPath, nowIso);
  const backupInfo = await createVerifiedBackup(dbPath, outputDir, label);
  const vapidPath = process.env.PATAP_VAPID_PATH || path.join(path.dirname(dbPath), "events", "vapid.json");
  const vapid = await inspectVapidKeyMaterial(vapidPath);
  const decision = evaluatePreflight({ database, backupInfo, roadSnapshot, vapid });

  const report = {
    version: 1,
    checkedAt: nowIso,
    candidate: process.env.PATAP_PREFLIGHT_CANDIDATE || null,
    sourceDatabase: { path: dbPath, readOnlyInspection: true, ...database },
    verifiedBackup: backupInfo,
    liveRoadReports: roadSnapshot,
    vapid: {
      path: vapidPath,
      exists: vapid.exists,
      valid: vapid.valid,
      sha256: vapid.sha256,
      bytes: vapid.bytes,
      createdAt: vapid.createdAt || null,
      secretMaterialIncluded: false
    },
    mutationPolicy: {
      sourceDatabaseWrites: false,
      migrationsRun: false,
      radioCleanupRun: false,
      servicesRestarted: false,
      onlyArtifactsWritten: true
    },
    decision
  };

  const reportPath = path.join(outputDir, `production-preflight-${label}.json`);
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf8");
  return { ...report, reportPath };
}

if (require.main === module) {
  runPreflight().then((report) => {
    const state = report.decision.ready ? "READY" : "BLOCKED";
    console.log(`PRODUCTION_PREFLIGHT ${state}`);
    console.log(`report=${report.reportPath}`);
    console.log(`backup=${report.verifiedBackup.path}`);
    console.log(`roadReports=${report.liveRoadReports.activeCount}`);
    console.log(`radioExpired=${report.sourceDatabase.radioRetention.expiredCommitted}`);
    console.log(`pushSubscriptions=${report.sourceDatabase.push.activeSubscriptions}`);
    if (report.decision.blockers.length) console.log(`blockers=${report.decision.blockers.join(",")}`);
    if (report.decision.warnings.length) console.log(`warnings=${report.decision.warnings.join(",")}`);
    if (!report.decision.ready) process.exitCode = 2;
  }).catch((error) => {
    console.error(`PRODUCTION_PREFLIGHT ERROR ${String(error?.message || error)}`);
    process.exitCode = 1;
  });
}

module.exports = {
  AUTH_SCHEMA_VERSION,
  tableExists,
  integrityCheck,
  inspectDatabase,
  createVerifiedBackup,
  inspectVapidKeyMaterial,
  captureRoadReportsSnapshot,
  evaluatePreflight,
  runPreflight
};
