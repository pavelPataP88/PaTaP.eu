const fs = require("fs");
const path = require("path");
const { backup, DatabaseSync } = require("node:sqlite");
const { DB_PATH, DATA_DIR } = require("./db");

function verifyBackup(filePath) {
  const checkDb = new DatabaseSync(filePath, { readOnly: true });
  try {
    const integrity = checkDb.prepare("PRAGMA integrity_check").get();
    if (!integrity || integrity.integrity_check !== "ok") {
      throw new Error("Backup integrity check failed");
    }
    const foreignKeys = checkDb.prepare("PRAGMA foreign_key_check").all();
    if (foreignKeys.length) throw new Error(`Backup foreign_key_check failed with ${foreignKeys.length} row(s)`);
    return { integrity: "ok", foreignKeyViolations: 0 };
  } finally {
    checkDb.close();
  }
}

async function createVerifiedBackup({ sourcePath = DB_PATH, backupDir = path.join(DATA_DIR, "backups"), stamp = new Date().toISOString().replace(/[:.]/g, "-") } = {}) {
  if (!fs.existsSync(sourcePath)) throw new Error(`Database not found: ${sourcePath}`);
  fs.mkdirSync(backupDir, { recursive: true });
  const target = path.join(backupDir, `patap-auth-${stamp}.sqlite`);
  const sourceDb = new DatabaseSync(sourcePath, { readOnly: true });
  try {
    await backup(sourceDb, target);
  } finally {
    sourceDb.close();
  }
  return { target, ...verifyBackup(target) };
}

async function main() {
  const result = await createVerifiedBackup();
  console.log(result.target);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = { verifyBackup, createVerifiedBackup };
