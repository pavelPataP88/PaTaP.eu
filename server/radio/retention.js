const fs = require("fs");
const path = require("path");

const RADIO_RETENTION_BATCH_SIZE = 100;
const RADIO_RETENTION_INTERVAL_MS = 15 * 60 * 1000;
const STORAGE_KEY_PATTERN = /^[A-Za-z0-9._-]{1,200}$/;

function safeStoragePath(storageDir, storageKey) {
  const key = String(storageKey || "");
  if (!STORAGE_KEY_PATTERN.test(key)) return null;
  const root = path.resolve(storageDir);
  const target = path.resolve(root, key);
  const relative = path.relative(root, target);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) return null;
  return target;
}

function createRadioRetentionCleaner({ db, storageDir, nowIso = () => new Date().toISOString(), fsImpl = fs } = {}) {
  if (!db || !storageDir) throw new Error("radio_retention_configuration_required");
  const candidates = db.prepare(`SELECT id, storage_key, byte_length
    FROM radio_transmissions
    WHERE state = 'COMMITTED' AND expires_at <= ?
    ORDER BY expires_at ASC, id ASC LIMIT ?`);
  const removeRow = db.prepare(`DELETE FROM radio_transmissions
    WHERE id = ? AND state = 'COMMITTED' AND expires_at <= ?`);

  function cleanupBatch({ limit = RADIO_RETENTION_BATCH_SIZE, now = nowIso() } = {}) {
    const numericLimit = Number(limit);
    const batchSize = Math.max(1, Math.min(500,
      Number.isSafeInteger(numericLimit) ? numericLimit : RADIO_RETENTION_BATCH_SIZE));
    const rows = candidates.all(now, batchSize);
    const result = {
      candidates: rows.length,
      deletedRows: 0,
      deletedFiles: 0,
      missingFiles: 0,
      bytesFreed: 0,
      failures: 0,
      failedIds: []
    };

    for (const row of rows) {
      const file = safeStoragePath(storageDir, row.storage_key);
      if (!file) {
        result.failures += 1;
        result.failedIds.push(Number(row.id));
        continue;
      }

      let existed = false;
      let missing = false;
      let bytes = 0;
      try {
        const stat = fsImpl.lstatSync(file);
        if (!stat.isFile() && !stat.isSymbolicLink()) throw new Error("radio_retention_storage_not_file");
        existed = true;
        bytes = stat.isFile() ? Number(stat.size) : 0;
      } catch (error) {
        if (error?.code === "ENOENT") missing = true;
        else {
          result.failures += 1;
          result.failedIds.push(Number(row.id));
          continue;
        }
      }

      try {
        fsImpl.rmSync(file, { force: true });
      } catch {
        result.failures += 1;
        result.failedIds.push(Number(row.id));
        continue;
      }

      try {
        const deleted = Number(removeRow.run(row.id, now).changes || 0);
        if (deleted !== 1) continue;
        result.deletedRows += 1;
        if (missing) result.missingFiles += 1;
        if (existed) {
          result.deletedFiles += 1;
          result.bytesFreed += bytes;
        }
      } catch {
        result.failures += 1;
        result.failedIds.push(Number(row.id));
      }
    }
    return result;
  }

  return { cleanupBatch };
}

function startRadioRetentionCleanup({
  cleaner,
  intervalMs = RADIO_RETENTION_INTERVAL_MS,
  batchSize = RADIO_RETENTION_BATCH_SIZE,
  logger = console
} = {}) {
  if (!cleaner || typeof cleaner.cleanupBatch !== "function") throw new Error("radio_retention_cleaner_required");
  let running = false;

  function run(reason) {
    if (running) return null;
    running = true;
    try {
      const result = cleaner.cleanupBatch({ limit: batchSize });
      if (result.deletedRows || result.failures) {
        logger?.info?.("radio_retention_cleanup", { reason, ...result });
      }
      return result;
    } catch (error) {
      logger?.error?.("radio_retention_cleanup_failed", {
        reason,
        error: String(error?.message || error)
      });
      return null;
    } finally {
      running = false;
    }
  }

  const startup = setImmediate(() => run("startup"));
  startup.unref?.();
  const timer = setInterval(
    () => run("interval"),
    Math.max(60_000, Number(intervalMs) || RADIO_RETENTION_INTERVAL_MS)
  );
  timer.unref?.();

  return {
    run,
    stop() {
      clearImmediate(startup);
      clearInterval(timer);
    }
  };
}

module.exports = {
  RADIO_RETENTION_BATCH_SIZE,
  RADIO_RETENTION_INTERVAL_MS,
  STORAGE_KEY_PATTERN,
  safeStoragePath,
  createRadioRetentionCleaner,
  startRadioRetentionCleanup
};
