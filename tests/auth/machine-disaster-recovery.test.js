const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

if (!process.env.PATAP_DB_PATH || !process.env.PATAP_TEST_RUN_ID) throw new Error("Machine DR tests must run through scripts/run-auth-tests.js");

const {
  FORMAT,
  normalizeLogicalPath,
  assertMaintenance,
  buildSourceEntries,
  exportMachineRecovery,
  verifyMachineRecoverySet,
  restoreMachineRecovery
} = require("../../server/recovery/machine-dr");

const passphrase = "driver-patap-machine-dr-test-passphrase-2026";

function write(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, value, { mode: 0o600 });
}

test("whole-machine DR encrypts database, private data and tunnel identity and restores a clean checkout", async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "patap-machine-dr-test-"));
  const dataRoot = path.join(base, "source-data");
  const secretPath = path.join(dataRoot, "config", "auth-secret.key");
  const vapidPath = path.join(dataRoot, "auth", "events", "vapid.json");
  const chatMediaPath = path.join(dataRoot, "auth", "chat", "media-object.bin");
  const radioMediaPath = path.join(dataRoot, "auth", "radio", "radio-object.webm");
  const parkingMediaPath = path.join(dataRoot, "auth", "parking", "parking-object.jpg");
  const tunnelTokenPath = path.join(base, "patap-lab-token.txt");
  const destination = path.join(base, "external-drive");
  const targetRoot = path.join(base, "fresh-checkout");
  const tunnelTarget = path.join(base, "fresh-localapp", "PatapLab", "cloudflared", "patap-lab-token.txt");

  write(secretPath, "auth-secret-material-test");
  write(vapidPath, JSON.stringify({ privateJwk: { d: "private-test" }, publicKey: "public-test" }));
  write(chatMediaPath, Buffer.from("chat-private-media"));
  write(radioMediaPath, Buffer.from("radio-private-media"));
  write(parkingMediaPath, Buffer.from("parking-private-media"));
  write(tunnelTokenPath, "cloudflare-tunnel-token-test");
  fs.mkdirSync(destination, { recursive: true });

  try {
    const exported = await exportMachineRecovery({
      destinationDir: destination,
      passphrase,
      allowSameDevice: true,
      dataRoot,
      dbPath: process.env.PATAP_DB_PATH,
      authSecretPath: secretPath,
      tunnelTokenPath,
      allowWithoutMaintenance: true,
      requireTunnelToken: true,
      sourceRef: "codex/local-workspace-snapshot",
      sourceSha: "faf56337ad060dec22649d81ce069218cff672f5"
    });

    assert.equal(exported.manifest.format, FORMAT);
    assert.equal(exported.manifest.restoreDrill, "PASS");
    assert.equal(exported.manifest.database.integrity, "ok");
    assert.equal(exported.manifest.database.foreignKeyViolations, 0);
    assert.ok(exported.manifest.objectCount >= 7);
    assert.ok(exported.manifest.totalPlaintextBytes > 0);
    assert.equal(exported.manifest.sourceSha, "faf56337ad060dec22649d81ce069218cff672f5");

    const publicManifest = fs.readFileSync(exported.manifestPath, "utf8");
    assert.equal(publicManifest.includes("auth-secret.key"), false, "plaintext manifest leaked a private path");
    assert.equal(publicManifest.includes("patap-lab-token"), false, "plaintext manifest leaked tunnel identity path");
    assert.equal(publicManifest.includes("chat-private-media"), false, "plaintext manifest leaked media content");

    const verified = await verifyMachineRecoverySet(exported.setDir, { passphrase });
    assert.equal(verified.restoreDrill, "PASS");
    assert.equal(verified.database.integrity, "ok");
    assert.equal(verified.objectCount, exported.manifest.objectCount);

    const restored = await restoreMachineRecovery({
      setDir: exported.setDir,
      targetRoot,
      tunnelTokenTarget: tunnelTarget,
      passphrase,
      confirm: "RESTORE",
      allowBareTarget: true
    });
    assert.equal(restored.restored, exported.manifest.objectCount);
    assert.equal(restored.database, "PASS");
    assert.equal(restored.publicActivationRequired, true);
    assert.equal(fs.readFileSync(path.join(targetRoot, "data", "config", "auth-secret.key"), "utf8"), "auth-secret-material-test");
    assert.equal(fs.readFileSync(path.join(targetRoot, "data", "auth", "events", "vapid.json"), "utf8"), fs.readFileSync(vapidPath, "utf8"));
    assert.deepEqual(fs.readFileSync(path.join(targetRoot, "data", "auth", "chat", "media-object.bin")), fs.readFileSync(chatMediaPath));
    assert.deepEqual(fs.readFileSync(path.join(targetRoot, "data", "auth", "radio", "radio-object.webm")), fs.readFileSync(radioMediaPath));
    assert.deepEqual(fs.readFileSync(path.join(targetRoot, "data", "auth", "parking", "parking-object.jpg")), fs.readFileSync(parkingMediaPath));
    assert.equal(fs.readFileSync(tunnelTarget, "utf8"), "cloudflare-tunnel-token-test");
    assert.ok(fs.existsSync(path.join(targetRoot, "data", "auth", "patap-auth.sqlite")));

    await assert.rejects(
      () => restoreMachineRecovery({ setDir: exported.setDir, targetRoot, tunnelTokenTarget: tunnelTarget, passphrase, confirm: "RESTORE", allowBareTarget: true }),
      /refuses_overwrite/i
    );
    await assert.rejects(
      () => verifyMachineRecoverySet(exported.setDir, { passphrase: "wrong-machine-recovery-passphrase" }),
      /decryption failed|key method|SHA-256/i
    );
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test("whole-machine DR fails closed on unsafe operation boundaries", async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "patap-machine-dr-guards-"));
  try {
    assert.throws(() => normalizeLogicalPath("../secret"), /invalid_recovery_path/);
    assert.throws(() => normalizeLogicalPath("C:\\secret\\file"), /invalid_recovery_path/);
    assert.throws(() => assertMaintenance(base), /requires_backend_maintenance/);
    assert.throws(
      () => buildSourceEntries({ dataRoot: base, dbPath: process.env.PATAP_DB_PATH, authSecretPath: null, tunnelTokenPath: null, requireTunnelToken: true }),
      /tunnel_token_missing/
    );
    await assert.rejects(
      () => restoreMachineRecovery({ setDir: base, targetRoot: path.join(base, "target"), passphrase, confirm: "NO", allowBareTarget: true }),
      /PATAP_MACHINE_RECOVERY_CONFIRM=RESTORE/
    );
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});
