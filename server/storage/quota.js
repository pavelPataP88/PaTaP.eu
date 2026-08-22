const fs = require("fs");
const path = require("path");

const MIB = 1024 * 1024;
const GIB = 1024 * MIB;
const DOMAINS = Object.freeze(["chat", "radio", "parking"]);

const DEFAULT_LIMITS = Object.freeze({
  userDailyBytes: 256 * MIB,
  userStoredBytes: 1 * GIB,
  globalStoredBytes: 8 * GIB,
  minFreeBytes: 2 * GIB,
  minFreeRatio: 0.05,
  radioReservationBytes: 3 * MIB,
  domainStoredBytes: Object.freeze({
    chat: 4 * GIB,
    radio: 2 * GIB,
    parking: 2 * GIB
  })
});

function envInteger(env, name, fallback, { allowZero = false } = {}) {
  const value = Number(env?.[name]);
  if (!Number.isSafeInteger(value) || value < (allowZero ? 0 : 1)) return fallback;
  return value;
}

function envRatio(env, name, fallback) {
  const value = Number(env?.[name]);
  return Number.isFinite(value) && value >= 0 && value < 1 ? value : fallback;
}

function resolvedLimits(env = process.env, overrides = {}) {
  const domainOverrides = overrides.domainStoredBytes || {};
  return {
    userDailyBytes: overrides.userDailyBytes ?? envInteger(env, "PATAP_MEDIA_USER_DAILY_BYTES", DEFAULT_LIMITS.userDailyBytes),
    userStoredBytes: overrides.userStoredBytes ?? envInteger(env, "PATAP_MEDIA_USER_STORED_BYTES", DEFAULT_LIMITS.userStoredBytes),
    globalStoredBytes: overrides.globalStoredBytes ?? envInteger(env, "PATAP_MEDIA_GLOBAL_STORED_BYTES", DEFAULT_LIMITS.globalStoredBytes),
    minFreeBytes: overrides.minFreeBytes ?? envInteger(env, "PATAP_MEDIA_MIN_FREE_BYTES", DEFAULT_LIMITS.minFreeBytes, { allowZero: true }),
    minFreeRatio: overrides.minFreeRatio ?? envRatio(env, "PATAP_MEDIA_MIN_FREE_RATIO", DEFAULT_LIMITS.minFreeRatio),
    radioReservationBytes: overrides.radioReservationBytes ?? envInteger(env, "PATAP_MEDIA_RADIO_RESERVATION_BYTES", DEFAULT_LIMITS.radioReservationBytes),
    domainStoredBytes: {
      chat: domainOverrides.chat ?? envInteger(env, "PATAP_MEDIA_CHAT_STORED_BYTES", DEFAULT_LIMITS.domainStoredBytes.chat),
      radio: domainOverrides.radio ?? envInteger(env, "PATAP_MEDIA_RADIO_STORED_BYTES", DEFAULT_LIMITS.domainStoredBytes.radio),
      parking: domainOverrides.parking ?? envInteger(env, "PATAP_MEDIA_PARKING_STORED_BYTES", DEFAULT_LIMITS.domainStoredBytes.parking)
    }
  };
}

function tableExists(db, table) {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table));
}

function number(value) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function nearestExistingPath(target, fsModule = fs) {
  let current = path.resolve(target);
  while (!fsModule.existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return current;
}

function defaultDiskProvider(dataDir, limits, fsModule = fs) {
  try {
    const stat = fsModule.statfsSync(nearestExistingPath(dataDir, fsModule));
    const blockSize = number(stat.bsize || stat.frsize);
    const totalBytes = number(stat.blocks) * blockSize;
    const availableBytes = number(stat.bavail ?? stat.bfree) * blockSize;
    if (!blockSize || !totalBytes) throw new Error("invalid_statfs");
    const minimumFreeBytes = Math.max(limits.minFreeBytes, Math.floor(totalBytes * limits.minFreeRatio));
    return {
      available: true,
      totalBytes,
      availableBytes,
      minimumFreeBytes,
      healthy: availableBytes >= minimumFreeBytes
    };
  } catch {
    return {
      available: false,
      totalBytes: null,
      availableBytes: null,
      minimumFreeBytes: limits.minFreeBytes,
      healthy: false
    };
  }
}

function createMediaQuota({ db, dataDir, env = process.env, limits: limitOverrides = {}, now = () => new Date(), fsModule = fs, diskProvider = null }) {
  if (!db) throw new Error("media_quota_db_required");
  if (!dataDir) throw new Error("media_quota_data_dir_required");
  const limits = resolvedLimits(env, limitOverrides);
  const disk = () => (diskProvider ? diskProvider({ dataDir, limits }) : defaultDiskProvider(dataDir, limits, fsModule));

  function nowIso() {
    const value = typeof now === "function" ? now() : now;
    const date = value instanceof Date ? value : new Date(value);
    return date.toISOString();
  }

  function sinceIso(hours = 24) {
    return new Date(Date.parse(nowIso()) - hours * 60 * 60 * 1000).toISOString();
  }

  function scalar(sql, ...params) {
    return number(db.prepare(sql).get(...params)?.bytes);
  }

  function chatUsage(userId = null) {
    if (!tableExists(db, "chat_uploads")) return { actualBytes: 0, reservedBytes: 0, accountedBytes: 0, dailyBytes: 0 };
    const current = nowIso();
    const since = sinceIso();
    const userSql = userId === null ? "" : " AND user_id=?";
    const userParams = userId === null ? [] : [userId];
    const actualBytes = scalar(`SELECT COALESCE(SUM(byte_length),0) AS bytes FROM chat_uploads WHERE state IN ('READY','ATTACHED')${userSql}`, ...userParams);
    const reservedBytes = scalar(`SELECT COALESCE(SUM(byte_length),0) AS bytes FROM chat_uploads WHERE state='PENDING' AND expires_at>?${userSql}`, current, ...userParams);
    const dailyBytes = scalar(`SELECT COALESCE(SUM(byte_length),0) AS bytes FROM chat_uploads WHERE created_at>=? AND (state IN ('READY','ATTACHED') OR (state='PENDING' AND expires_at>?))${userSql}`, since, current, ...userParams);
    return { actualBytes, reservedBytes, accountedBytes: actualBytes + reservedBytes, dailyBytes };
  }

  function radioUsage(userId = null) {
    if (!tableExists(db, "radio_transmissions")) return { actualBytes: 0, reservedBytes: 0, accountedBytes: 0, dailyBytes: 0 };
    const current = nowIso();
    const since = sinceIso();
    const userSql = userId === null ? "" : " AND sender_id=?";
    const userParams = userId === null ? [] : [userId];
    const actualBytes = scalar(`SELECT COALESCE(SUM(byte_length),0) AS bytes FROM radio_transmissions WHERE state='COMMITTED'${userSql}`, ...userParams);
    const uploading = scalar(`SELECT COUNT(*) AS bytes FROM radio_transmissions WHERE state='UPLOADING' AND expires_at>?${userSql}`, current, ...userParams);
    const reservedBytes = uploading * limits.radioReservationBytes;
    const dailyCommitted = scalar(`SELECT COALESCE(SUM(byte_length),0) AS bytes FROM radio_transmissions WHERE state='COMMITTED' AND created_at>=?${userSql}`, since, ...userParams);
    const dailyUploading = scalar(`SELECT COUNT(*) AS bytes FROM radio_transmissions WHERE state='UPLOADING' AND expires_at>? AND created_at>=?${userSql}`, current, since, ...userParams);
    return {
      actualBytes,
      reservedBytes,
      accountedBytes: actualBytes + reservedBytes,
      dailyBytes: dailyCommitted + dailyUploading * limits.radioReservationBytes
    };
  }

  function parkingUsage(userId = null) {
    if (!tableExists(db, "parking_photos")) return { actualBytes: 0, reservedBytes: 0, accountedBytes: 0, dailyBytes: 0 };
    const since = sinceIso();
    const userSql = userId === null ? "" : " AND uploader_id=?";
    const userParams = userId === null ? [] : [userId];
    const actualBytes = scalar(`SELECT COALESCE(SUM(byte_length),0) AS bytes FROM parking_photos WHERE state IN ('VISIBLE','HIDDEN')${userSql}`, ...userParams);
    const dailyBytes = scalar(`SELECT COALESCE(SUM(byte_length),0) AS bytes FROM parking_photos WHERE state IN ('VISIBLE','HIDDEN') AND created_at>=?${userSql}`, since, ...userParams);
    return { actualBytes, reservedBytes: 0, accountedBytes: actualBytes, dailyBytes };
  }

  function domainUsage(domain, userId = null) {
    if (domain === "chat") return chatUsage(userId);
    if (domain === "radio") return radioUsage(userId);
    if (domain === "parking") return parkingUsage(userId);
    throw new Error("invalid_media_domain");
  }

  function usage(userId = null) {
    const domains = Object.fromEntries(DOMAINS.map((domain) => [domain, domainUsage(domain, userId)]));
    return {
      domains,
      actualBytes: DOMAINS.reduce((sum, domain) => sum + domains[domain].actualBytes, 0),
      reservedBytes: DOMAINS.reduce((sum, domain) => sum + domains[domain].reservedBytes, 0),
      accountedBytes: DOMAINS.reduce((sum, domain) => sum + domains[domain].accountedBytes, 0),
      dailyBytes: DOMAINS.reduce((sum, domain) => sum + domains[domain].dailyBytes, 0)
    };
  }

  function rejection(error, status, scope, usedBytes, limitBytes, requestedBytes) {
    return { ok: false, error, status, scope, usedBytes, limitBytes, requestedBytes };
  }

  function checkUpload(userId, domain, requestedBytes) {
    const bytes = Number(requestedBytes);
    if (!DOMAINS.includes(domain) || !Number.isSafeInteger(bytes) || bytes < 1) {
      return rejection("invalid_media_quota_request", 400, "request", 0, 0, bytes);
    }
    const user = usage(userId);
    const domainState = usage().domains[domain];
    const global = usage();

    if (user.dailyBytes + bytes > limits.userDailyBytes) {
      return rejection("media_daily_quota_exceeded", 429, "user_daily", user.dailyBytes, limits.userDailyBytes, bytes);
    }
    if (user.accountedBytes + bytes > limits.userStoredBytes) {
      return rejection("media_user_storage_quota_exceeded", 507, "user_storage", user.accountedBytes, limits.userStoredBytes, bytes);
    }
    if (domainState.accountedBytes + bytes > limits.domainStoredBytes[domain]) {
      return rejection("media_domain_storage_quota_exceeded", 507, `domain_${domain}`, domainState.accountedBytes, limits.domainStoredBytes[domain], bytes);
    }
    if (global.accountedBytes + bytes > limits.globalStoredBytes) {
      return rejection("media_global_storage_quota_exceeded", 507, "global_storage", global.accountedBytes, limits.globalStoredBytes, bytes);
    }

    const diskState = disk();
    if (!diskState.available) {
      return rejection("media_storage_unavailable", 507, "disk", 0, diskState.minimumFreeBytes, bytes);
    }
    if (diskState.availableBytes - bytes < diskState.minimumFreeBytes) {
      return rejection("media_low_disk", 507, "disk", diskState.totalBytes - diskState.availableBytes, diskState.totalBytes - diskState.minimumFreeBytes, bytes);
    }
    return { ok: true, requestedBytes: bytes, user, domain: domainState, global, disk: diskState };
  }

  function referencedStorageKeys(domain) {
    if (domain === "chat") {
      const keys = new Set();
      if (tableExists(db, "chat_uploads")) {
        for (const row of db.prepare("SELECT storage_key FROM chat_uploads WHERE state IN ('READY','ATTACHED')").all()) if (row.storage_key) keys.add(String(row.storage_key));
      }
      if (tableExists(db, "chat_message_attachments")) {
        for (const row of db.prepare("SELECT DISTINCT storage_key FROM chat_message_attachments").all()) if (row.storage_key) keys.add(String(row.storage_key));
      }
      return keys;
    }
    if (domain === "radio") {
      if (!tableExists(db, "radio_transmissions")) return new Set();
      return new Set(db.prepare("SELECT storage_key FROM radio_transmissions WHERE state='COMMITTED'").all().map((row) => String(row.storage_key)).filter(Boolean));
    }
    if (domain === "parking") {
      if (!tableExists(db, "parking_photos")) return new Set();
      return new Set(db.prepare("SELECT storage_key FROM parking_photos WHERE state IN ('VISIBLE','HIDDEN')").all().map((row) => String(row.storage_key)).filter(Boolean));
    }
    throw new Error("invalid_media_domain");
  }

  function fileInventory(domain) {
    const directory = path.join(dataDir, domain);
    const files = new Map();
    try {
      for (const entry of fsModule.readdirSync(directory, { withFileTypes: true })) {
        if (!entry.isFile()) continue;
        try {
          const stat = fsModule.statSync(path.join(directory, entry.name));
          if (stat.isFile()) files.set(entry.name, number(stat.size));
        } catch {}
      }
    } catch {}
    return files;
  }

  function scanDomain(domain) {
    const references = referencedStorageKeys(domain);
    const files = fileInventory(domain);
    let unreferencedFiles = 0;
    let unreferencedBytes = 0;
    for (const [name, bytes] of files) {
      if (references.has(name)) continue;
      unreferencedFiles += 1;
      unreferencedBytes += bytes;
    }
    let missingReferencedFiles = 0;
    for (const key of references) if (!files.has(key)) missingReferencedFiles += 1;
    return {
      directoryFiles: files.size,
      referencedFiles: references.size,
      unreferencedFiles,
      unreferencedBytes,
      missingReferencedFiles
    };
  }

  function scanOrphans() {
    return Object.fromEntries(DOMAINS.map((domain) => [domain, scanDomain(domain)]));
  }

  function topUsers(limit = 10) {
    if (!tableExists(db, "users")) return [];
    const ids = db.prepare("SELECT id,username FROM users ORDER BY id").all();
    return ids.map((row) => {
      const state = usage(Number(row.id));
      return { userId: Number(row.id), username: row.username, accountedBytes: state.accountedBytes, dailyBytes: state.dailyBytes };
    }).filter((row) => row.accountedBytes > 0 || row.dailyBytes > 0)
      .sort((a, b) => b.accountedBytes - a.accountedBytes || b.dailyBytes - a.dailyBytes)
      .slice(0, Math.max(1, Math.min(50, Number(limit) || 10)));
  }

  function adminStats() {
    return {
      generatedAt: nowIso(),
      limits,
      usage: usage(),
      disk: disk(),
      diagnostics: scanOrphans(),
      topUsers: topUsers(10),
      destructiveCleanupEnabled: false
    };
  }

  return {
    limits,
    checkUpload,
    usage,
    domainUsage,
    disk,
    scanOrphans,
    adminStats
  };
}

module.exports = {
  MIB,
  GIB,
  DOMAINS,
  DEFAULT_LIMITS,
  resolvedLimits,
  defaultDiskProvider,
  createMediaQuota
};
