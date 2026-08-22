const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { DB_PATH } = require("./db");
const { createVerifiedBackup } = require("./backup-db");
const { assertDifferentDevice, encryptFile, sha256File, verifyPackage } = require("./dr-package");

async function exportDisasterRecoveryBackup({
  destinationDir = process.env.PATAP_DR_EXPORT_DIR,
  keyFile = process.env.PATAP_DR_KEY_FILE,
  passphrase = process.env.PATAP_DR_PASSPHRASE,
  allowSameDevice = process.env.PATAP_DR_ALLOW_SAME_DEVICE === "YES"
} = {}) {
  if (!destinationDir) throw new Error("Set PATAP_DR_EXPORT_DIR to a second device or network share");
  const destination = assertDifferentDevice(DB_PATH, path.resolve(destinationDir), { allowSameDevice });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const local = await createVerifiedBackup({ stamp });
  const packagePath = path.join(destination, `patap-auth-${stamp}.patapdr`);
  const encrypted = await encryptFile(local.target, packagePath, { keyFile, passphrase });
  const temporary = path.join(os.tmpdir(), `patap-dr-verify-${process.pid}-${Date.now()}.sqlite`);
  const drill = await verifyPackage(packagePath, temporary, { keyFile, passphrase });
  const manifest = {
    format: "PATAP-DR1",
    createdAt: encrypted.header.createdAt,
    package: path.basename(packagePath),
    packageSha256: encrypted.packageSha256,
    plaintextSha256: encrypted.header.plaintextSha256,
    localBackupSha256: await sha256File(local.target),
    sqlite: drill.sqlite,
    restoreDrill: "PASS"
  };
  const manifestPath = `${packagePath}.json`;
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
  return { packagePath, manifestPath, localBackup: local.target, manifest };
}

async function main() {
  const result = await exportDisasterRecoveryBackup();
  console.log(JSON.stringify({
    packagePath: result.packagePath,
    manifestPath: result.manifestPath,
    localBackup: result.localBackup,
    restoreDrill: result.manifest.restoreDrill,
    authSchemaVersion: result.manifest.sqlite.authSchemaVersion
  }, null, 2));
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = { exportDisasterRecoveryBackup };
