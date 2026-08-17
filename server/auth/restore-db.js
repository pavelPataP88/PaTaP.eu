const fs = require("fs");
const path = require("path");
const { backup, DatabaseSync } = require("node:sqlite");
const { DB_PATH, DATA_DIR } = require("./db");

const source = process.argv[2];
if (!source || !fs.existsSync(source)) {
  console.error("Usage: set PATAP_RESTORE_CONFIRM=YES && node server/auth/restore-db.js <backup-sqlite-path>");
  process.exit(1);
}
if (process.env.PATAP_RESTORE_CONFIRM !== "YES") {
  console.error("Restore refused. Stop the auth backend and set PATAP_RESTORE_CONFIRM=YES.");
  process.exit(1);
}

async function main() {
  if (!process.env.PATAP_DB_PATH) {
    const port = Number(process.env.PATAP_AUTH_PORT || 8091);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(750) });
      if (response.ok) throw new Error("Restore refused while the auth backend is running. Stop it before restoring.");
    } catch (error) {
      if (error.message?.startsWith("Restore refused")) throw error;
    }
  }
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const sourcePath = path.resolve(source);
  const sourceDb = new DatabaseSync(sourcePath, { readOnly: true });
  try {
    const integrity = sourceDb.prepare("PRAGMA integrity_check").get();
    if (!integrity || integrity.integrity_check !== "ok") {
      throw new Error("Source backup failed SQLite integrity_check");
    }
  } finally {
    sourceDb.close();
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const temporary = `${DB_PATH}.restore-${stamp}.tmp`;
  const restoreSource = new DatabaseSync(sourcePath, { readOnly: true });
  try {
    await backup(restoreSource, temporary);
  } finally {
    restoreSource.close();
  }

  const verified = new DatabaseSync(temporary, { readOnly: true });
  try {
    if (verified.prepare("PRAGMA integrity_check").get().integrity_check !== "ok") {
      throw new Error("Restored temporary database failed integrity_check");
    }
  } finally {
    verified.close();
  }

  const previous = `${DB_PATH}.before-restore-${stamp}`;
  try {
    if (fs.existsSync(DB_PATH)) fs.renameSync(DB_PATH, previous);
    for (const suffix of ["-wal", "-shm"]) {
      fs.rmSync(`${DB_PATH}${suffix}`, { force: true });
    }
    fs.renameSync(temporary, DB_PATH);
  } catch (error) {
    fs.rmSync(temporary, { force: true });
    if (!fs.existsSync(DB_PATH) && fs.existsSync(previous)) fs.renameSync(previous, DB_PATH);
    throw new Error(`Restore failed safely. Ensure the auth backend is stopped. ${error.message}`);
  }

  console.log(`Restored ${sourcePath} -> ${DB_PATH}`);
  if (fs.existsSync(previous)) console.log(`Previous database: ${previous}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
