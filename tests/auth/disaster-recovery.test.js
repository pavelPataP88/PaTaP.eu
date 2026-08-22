const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

if (!process.env.PATAP_DB_PATH || !process.env.PATAP_TEST_RUN_ID) throw new Error("DR tests must run through scripts/run-auth-tests.js");

const { exportDisasterRecoveryBackup } = require("../../server/auth/export-dr-backup");
const { verifyPackage, assertDifferentDevice } = require("../../server/auth/dr-package");

const passphrase = "driver-patap-dr-test-passphrase-2026";

test("encrypted DR export performs a verified restore drill without exposing raw SQLite", async () => {
  const destination = fs.mkdtempSync(path.join(os.tmpdir(), "patap-dr-destination-"));
  const verifyTarget = path.join(os.tmpdir(), `patap-dr-second-verify-${process.pid}-${Date.now()}.sqlite`);
  try {
    const result = await exportDisasterRecoveryBackup({ destinationDir: destination, passphrase, allowSameDevice: true });
    assert.equal(result.manifest.format, "PATAP-DR1");
    assert.equal(result.manifest.restoreDrill, "PASS");
    assert.equal(result.manifest.sqlite.integrity, "ok");
    assert.equal(result.manifest.sqlite.foreignKeyViolations, 0);
    assert.equal(result.manifest.plaintextSha256, result.manifest.localBackupSha256);
    assert.match(result.manifest.packageSha256, /^[a-f0-9]{64}$/);
    assert.ok(fs.existsSync(result.packagePath));
    assert.ok(fs.existsSync(result.manifestPath));
    const prefix = fs.readFileSync(result.packagePath).subarray(0, 32).toString("utf8");
    assert.ok(prefix.startsWith("PATAP-DR1\n"));
    assert.equal(prefix.includes("SQLite format 3"), false, "encrypted package leaked SQLite header");

    const second = await verifyPackage(result.packagePath, verifyTarget, { passphrase });
    assert.equal(second.sqlite.integrity, "ok");
    assert.equal(second.plaintextSha256, result.manifest.plaintextSha256);
    await assert.rejects(
      () => verifyPackage(result.packagePath, `${verifyTarget}.wrong`, { passphrase: "wrong-passphrase-that-is-long-enough" }),
      /decryption failed|key method|SHA-256/i
    );
  } finally {
    fs.rmSync(destination, { recursive: true, force: true });
    fs.rmSync(verifyTarget, { force: true });
    fs.rmSync(`${verifyTarget}.wrong`, { force: true });
  }
});

test("DR export refuses the live database filesystem unless an explicit test override is used", () => {
  const liveDir = path.dirname(path.resolve(process.env.PATAP_DB_PATH));
  assert.throws(
    () => assertDifferentDevice(process.env.PATAP_DB_PATH, liveDir, { allowSameDevice: false }),
    /must not be inside|same filesystem\/device/i
  );
});

require("./machine-disaster-recovery.test.js");
