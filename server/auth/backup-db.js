const fs = require("fs");
const path = require("path");
const { backup, DatabaseSync } = require("node:sqlite");
const { DB_PATH, DATA_DIR } = require("./db");

async function main() {
  if (!fs.existsSync(DB_PATH)) {
    throw new Error(`Database not found: ${DB_PATH}`);
  }

  const backupDir = path.join(DATA_DIR, "backups");
  fs.mkdirSync(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const target = path.join(backupDir, `patap-auth-${stamp}.sqlite`);
  const sourceDb = new DatabaseSync(DB_PATH, { readOnly: true });

  try {
    await backup(sourceDb, target);
  } finally {
    sourceDb.close();
  }

  const checkDb = new DatabaseSync(target, { readOnly: true });
  try {
    const integrity = checkDb.prepare("PRAGMA integrity_check").get();
    if (!integrity || integrity.integrity_check !== "ok") {
      throw new Error("Backup integrity check failed");
    }
  } finally {
    checkDb.close();
  }

  console.log(target);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
