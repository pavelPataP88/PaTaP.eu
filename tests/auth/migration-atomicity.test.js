const test = require("node:test");
const assert = require("node:assert/strict");
const { DatabaseSync } = require("node:sqlite");
const {
  AUTH_SCHEMA_VERSION,
  migrate,
  runMigrationTransaction,
  assertAuthSchemaV12
} = require("../../server/auth/db");

function memoryDb() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  return db;
}

function integrity(db) {
  return db.prepare("PRAGMA integrity_check").all().map((row) => row.integrity_check);
}

test("auth schema migrates from empty database to contiguous v12 with valid structure", () => {
  const db = memoryDb();
  migrate(db);
  const versions = db.prepare("SELECT version FROM schema_migrations ORDER BY version").all().map((row) => Number(row.version));
  assert.deepEqual(versions, Array.from({ length: AUTH_SCHEMA_VERSION }, (_, index) => index + 1));
  assert.equal(db.prepare("SELECT MAX(version) AS version FROM schema_migrations").get().version, AUTH_SCHEMA_VERSION);
  assert.doesNotThrow(() => assertAuthSchemaV12(db));
  assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
  assert.deepEqual(integrity(db), ["ok"]);
  db.close();
});

test("migration transaction rolls back DDL and version marker when fault occurs between them", () => {
  const db = memoryDb();
  db.exec("CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)");

  assert.throws(() => runMigrationTransaction(db, () => {
    db.exec("CREATE TABLE fault_probe(id INTEGER PRIMARY KEY)");
    db.prepare("INSERT INTO schema_migrations(version, applied_at) VALUES(1, ?)").run("2026-08-21T00:00:00.000Z");
    throw new Error("fault_injected_after_ddl_before_commit");
  }), /fault_injected_after_ddl_before_commit/);

  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM schema_migrations").get().n, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sqlite_schema WHERE type='table' AND name='fault_probe'").get().n, 0);
  assert.deepEqual(integrity(db), ["ok"]);
  db.close();
});

test("legacy partial migration is blocked explicitly without adding more partial schema", () => {
  const db = memoryDb();
  db.exec(`
    CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
    CREATE TABLE users(id INTEGER PRIMARY KEY AUTOINCREMENT);
  `);

  let error;
  try { migrate(db); } catch (caught) { error = caught; }
  assert.ok(error);
  assert.equal(error.code, "LEGACY_PARTIAL_MIGRATION");
  assert.match(error.message, /^legacy_partial_migration_detected:v0:/);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM schema_migrations").get().n, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sqlite_schema WHERE type='table' AND name='users'").get().n, 1);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sqlite_schema WHERE type='table' AND name='sessions'").get().n, 0);
  assert.deepEqual(integrity(db), ["ok"]);
  db.close();
});

test("recorded v12 with a missing required schema object fails closed", () => {
  const db = memoryDb();
  migrate(db);
  db.exec("DROP INDEX radio_transmissions_expiry_idx");
  assert.throws(() => migrate(db), /auth_schema_missing_index:radio_transmissions_expiry_idx/);
  assert.deepEqual(integrity(db), ["ok"]);
  db.close();
});
