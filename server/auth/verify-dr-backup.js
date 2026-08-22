const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { verifyPackage } = require("./dr-package");

async function main() {
  const source = process.argv[2];
  if (!source || !fs.existsSync(source)) {
    throw new Error("Usage: node server/auth/verify-dr-backup.js <package.patapdr>");
  }
  const temporary = path.join(os.tmpdir(), `patap-dr-verify-${process.pid}-${Date.now()}.sqlite`);
  const result = await verifyPackage(source, temporary, {
    keyFile: process.env.PATAP_DR_KEY_FILE,
    passphrase: process.env.PATAP_DR_PASSPHRASE
  });
  console.log(JSON.stringify({
    package: path.resolve(source),
    packageSha256: result.packageSha256,
    plaintextSha256: result.plaintextSha256,
    sqlite: result.sqlite,
    restoreDrill: "PASS"
  }, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
