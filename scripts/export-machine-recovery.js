const { exportMachineRecovery } = require("../server/recovery/machine-dr");

async function main() {
  const result = await exportMachineRecovery();
  console.log(JSON.stringify({
    setDir: result.setDir,
    manifestPath: result.manifestPath,
    format: result.manifest.format,
    objectCount: result.manifest.objectCount,
    totalPlaintextBytes: result.manifest.totalPlaintextBytes,
    authSchemaVersion: result.manifest.database?.authSchemaVersion || null,
    restoreDrill: result.manifest.restoreDrill,
    sourceRef: result.manifest.sourceRef,
    sourceSha: result.manifest.sourceSha || null
  }, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
