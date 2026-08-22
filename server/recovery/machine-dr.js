const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { DB_PATH, SECRET_PATH } = require("../auth/db");
const { createVerifiedBackup } = require("../auth/backup-db");
const { assertDifferentDevice, encryptFile, decryptFile, sha256File, verifySqlite } = require("../auth/dr-package");

const FORMAT = "PATAP-MACHINE-DR1";
const INDEX_FORMAT = "PATAP-MACHINE-INDEX1";
const ROOT = path.resolve(__dirname, "..", "..");
const DEFAULT_DATA_ROOT = path.join(ROOT, "data");
const MAINTENANCE_FLAG = path.join("var", "run", "patap-auth-maintenance.flag");
const LIVE_DB_SUFFIXES = new Set(["", "-wal", "-shm"]);

function defaultTunnelTokenPath(env = process.env) {
  return env.LOCALAPPDATA ? path.join(env.LOCALAPPDATA, "PatapLab", "cloudflared", "patap-lab-token.txt") : null;
}

function normalizeLogicalPath(value) {
  const normalized = String(value || "").replace(/\\/g, "/");
  if (!normalized || normalized.startsWith("/") || /^[A-Za-z]:/.test(normalized)) throw new Error("invalid_recovery_path");
  const parts = normalized.split("/");
  if (parts.some((part) => !part || part === "." || part === ".." || part.includes("\0"))) throw new Error("invalid_recovery_path");
  return parts.join("/");
}

function pathInside(parent, child) {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function shouldSkipDataPath(fullPath, { dataRoot, dbPath }) {
  const resolved = path.resolve(fullPath);
  const relative = path.relative(path.resolve(dataRoot), resolved).replace(/\\/g, "/");
  if (relative === "auth/backups" || relative.startsWith("auth/backups/")) return true;
  const database = path.resolve(dbPath);
  return [...LIVE_DB_SUFFIXES].some((suffix) => resolved === `${database}${suffix}`);
}

function collectDataFiles(dataRoot, { dbPath = DB_PATH } = {}) {
  const root = path.resolve(dataRoot);
  if (!fs.existsSync(root)) return [];
  const output = [];
  const walk = (directory) => {
    const entries = fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const fullPath = path.join(directory, entry.name);
      if (shouldSkipDataPath(fullPath, { dataRoot: root, dbPath })) continue;
      const stat = fs.lstatSync(fullPath);
      if (stat.isSymbolicLink()) throw new Error(`recovery_refuses_symlink:${fullPath}`);
      if (stat.isDirectory()) walk(fullPath);
      else if (stat.isFile()) {
        output.push({
          kind: "private-data",
          sourcePath: fullPath,
          logicalPath: normalizeLogicalPath(`data/${path.relative(root, fullPath).replace(/\\/g, "/")}`)
        });
      } else {
        throw new Error(`recovery_refuses_special_file:${fullPath}`);
      }
    }
  };
  walk(root);
  return output;
}

function assertMaintenance(root = ROOT, { allowWithoutMaintenance = false } = {}) {
  if (allowWithoutMaintenance) return;
  const marker = path.join(path.resolve(root), MAINTENANCE_FLAG);
  if (!fs.existsSync(marker)) throw new Error("machine_recovery_requires_backend_maintenance");
}

async function assertBackendOffline(backendProbeUrl = "http://127.0.0.1:8091/api/health", { skipProbe = false } = {}) {
  if (skipProbe || !backendProbeUrl) return;
  try {
    const response = await fetch(backendProbeUrl, { signal: AbortSignal.timeout(800), cache: "no-store" });
    if (response) throw new Error("machine_recovery_backend_still_running");
  } catch (error) {
    if (error?.message === "machine_recovery_backend_still_running") throw error;
  }
}

function validateSourceSha(value) {
  const text = String(value || "").trim();
  return /^[a-f0-9]{40}$/i.test(text) ? text.toLowerCase() : null;
}

function buildSourceEntries({ dataRoot, dbPath, authSecretPath, tunnelTokenPath, requireTunnelToken = true }) {
  const entries = collectDataFiles(dataRoot, { dbPath });
  if (authSecretPath && fs.existsSync(authSecretPath) && !pathInside(dataRoot, authSecretPath)) {
    entries.push({ kind: "auth-secret", sourcePath: path.resolve(authSecretPath), logicalPath: "data/config/auth-secret.key" });
  }
  if (requireTunnelToken && (!tunnelTokenPath || !fs.existsSync(tunnelTokenPath))) {
    throw new Error("machine_recovery_tunnel_token_missing");
  }
  if (tunnelTokenPath && fs.existsSync(tunnelTokenPath)) {
    entries.push({ kind: "tunnel-token", sourcePath: path.resolve(tunnelTokenPath), logicalPath: "external/cloudflare/patap-lab-token.txt" });
  }
  const seen = new Set();
  return entries
    .map((entry) => ({ ...entry, logicalPath: normalizeLogicalPath(entry.logicalPath) }))
    .filter((entry) => {
      if (seen.has(entry.logicalPath)) return false;
      seen.add(entry.logicalPath);
      return true;
    })
    .sort((a, b) => a.logicalPath.localeCompare(b.logicalPath));
}

async function encryptEntry(entry, objectDir, index, credentials) {
  const stat = fs.lstatSync(entry.sourcePath);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`invalid_recovery_source:${entry.logicalPath}`);
  const id = String(index + 1).padStart(8, "0");
  const packageName = `${id}.patapdr`;
  const encrypted = await encryptFile(entry.sourcePath, path.join(objectDir, packageName), credentials);
  return {
    id,
    package: packageName,
    kind: entry.kind,
    logicalPath: entry.logicalPath,
    byteLength: stat.size,
    plaintextSha256: encrypted.header.plaintextSha256,
    packageSha256: encrypted.packageSha256
  };
}

async function readEncryptedIndex(setDir, credentials = {}) {
  const manifestPath = path.join(setDir, "manifest.json");
  const indexPackagePath = path.join(setDir, "index.patapdr");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  if (manifest.format !== FORMAT || manifest.version !== 1) throw new Error("unsupported_machine_recovery_manifest");
  const actualIndexSha = await sha256File(indexPackagePath);
  if (actualIndexSha !== manifest.indexPackageSha256) throw new Error("machine_recovery_index_sha_mismatch");
  const temporaryIndex = path.join(os.tmpdir(), `patap-machine-index-${process.pid}-${crypto.randomUUID()}.json`);
  try {
    await decryptFile(indexPackagePath, temporaryIndex, credentials);
    const index = JSON.parse(fs.readFileSync(temporaryIndex, "utf8"));
    if (index.format !== INDEX_FORMAT || index.version !== 1 || !Array.isArray(index.entries)) throw new Error("unsupported_machine_recovery_index");
    if (index.entries.length !== Number(manifest.objectCount)) throw new Error("machine_recovery_object_count_mismatch");
    const seenIds = new Set();
    const seenPaths = new Set();
    for (const entry of index.entries) {
      entry.logicalPath = normalizeLogicalPath(entry.logicalPath);
      if (!/^\d{8}$/.test(String(entry.id)) || seenIds.has(entry.id)) throw new Error("invalid_machine_recovery_object_id");
      if (seenPaths.has(entry.logicalPath)) throw new Error("duplicate_machine_recovery_path");
      if (!/^[a-f0-9]{64}$/i.test(String(entry.plaintextSha256)) || !/^[a-f0-9]{64}$/i.test(String(entry.packageSha256))) throw new Error("invalid_machine_recovery_hash");
      if (!Number.isSafeInteger(Number(entry.byteLength)) || Number(entry.byteLength) < 0) throw new Error("invalid_machine_recovery_size");
      seenIds.add(entry.id);
      seenPaths.add(entry.logicalPath);
    }
    return { manifest, index };
  } finally {
    fs.rmSync(temporaryIndex, { force: true });
  }
}

async function verifyMachineRecoverySet(setDir, credentials = {}) {
  const resolved = path.resolve(setDir);
  const { manifest, index } = await readEncryptedIndex(resolved, credentials);
  const objectsDir = path.join(resolved, "objects");
  let totalPlaintextBytes = 0;
  let database = null;
  for (const entry of index.entries) {
    const packagePath = path.join(objectsDir, `${entry.id}.patapdr`);
    if (!fs.existsSync(packagePath)) throw new Error(`machine_recovery_object_missing:${entry.id}`);
    const packageSha = await sha256File(packagePath);
    if (packageSha !== entry.packageSha256) throw new Error(`machine_recovery_object_sha_mismatch:${entry.id}`);
    const temporary = path.join(os.tmpdir(), `patap-machine-object-${process.pid}-${entry.id}-${crypto.randomUUID()}`);
    try {
      const restored = await decryptFile(packagePath, temporary, credentials);
      if (restored.plaintextSha256 !== entry.plaintextSha256) throw new Error(`machine_recovery_plaintext_sha_mismatch:${entry.id}`);
      const stat = fs.statSync(temporary);
      if (stat.size !== Number(entry.byteLength)) throw new Error(`machine_recovery_size_mismatch:${entry.id}`);
      if (entry.kind === "database") database = verifySqlite(temporary);
      totalPlaintextBytes += stat.size;
    } finally {
      fs.rmSync(temporary, { force: true });
    }
  }
  if (!database) throw new Error("machine_recovery_database_missing");
  if (totalPlaintextBytes !== Number(manifest.totalPlaintextBytes)) throw new Error("machine_recovery_total_size_mismatch");
  return { format: manifest.format, objectCount: index.entries.length, totalPlaintextBytes, database, sourceRef: manifest.sourceRef, sourceSha: manifest.sourceSha || null, restoreDrill: "PASS" };
}

async function exportMachineRecovery({
  destinationDir = process.env.PATAP_MACHINE_DR_EXPORT_DIR || process.env.PATAP_DR_EXPORT_DIR,
  keyFile = process.env.PATAP_DR_KEY_FILE,
  passphrase = process.env.PATAP_DR_PASSPHRASE,
  allowSameDevice = process.env.PATAP_DR_ALLOW_SAME_DEVICE === "YES",
  root = ROOT,
  dataRoot = DEFAULT_DATA_ROOT,
  dbPath = DB_PATH,
  authSecretPath = SECRET_PATH,
  tunnelTokenPath = defaultTunnelTokenPath(),
  requireTunnelToken = true,
  allowWithoutMaintenance = false,
  skipBackendProbe = false,
  backendProbeUrl = "http://127.0.0.1:8091/api/health",
  sourceRef = process.env.PATAP_RECOVERY_SOURCE_REF || "codex/local-workspace-snapshot",
  sourceSha = validateSourceSha(process.env.PATAP_RECOVERY_SOURCE_SHA)
} = {}) {
  if (!destinationDir) throw new Error("Set PATAP_MACHINE_DR_EXPORT_DIR to a second device or network share");
  assertMaintenance(root, { allowWithoutMaintenance });
  await assertBackendOffline(backendProbeUrl, { skipProbe: skipBackendProbe || allowWithoutMaintenance });
  const destination = assertDifferentDevice(dbPath, path.resolve(destinationDir), { allowSameDevice });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const setDir = path.join(destination, `patap-machine-${stamp}`);
  const objectDir = path.join(setDir, "objects");
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "patap-machine-source-"));
  const credentials = { keyFile, passphrase };
  let complete = false;
  try {
    fs.mkdirSync(setDir, { recursive: false, mode: 0o700 });
    fs.mkdirSync(objectDir, { recursive: false, mode: 0o700 });
    const verifiedDb = await createVerifiedBackup({ sourcePath: dbPath, backupDir: tempDir, stamp });
    const sourceEntries = [
      { kind: "database", sourcePath: verifiedDb.target, logicalPath: "data/auth/patap-auth.sqlite" },
      ...buildSourceEntries({ dataRoot, dbPath, authSecretPath, tunnelTokenPath, requireTunnelToken })
    ];
    const entries = [];
    for (let index = 0; index < sourceEntries.length; index += 1) {
      entries.push(await encryptEntry(sourceEntries[index], objectDir, index, credentials));
    }
    const createdAt = new Date().toISOString();
    const encryptedIndexPayload = { format: INDEX_FORMAT, version: 1, createdAt, entries };
    const tempIndex = path.join(tempDir, "index.json");
    fs.writeFileSync(tempIndex, `${JSON.stringify(encryptedIndexPayload)}\n`, { mode: 0o600, flag: "wx" });
    const encryptedIndex = await encryptFile(tempIndex, path.join(setDir, "index.patapdr"), credentials);
    const manifest = {
      format: FORMAT,
      version: 1,
      createdAt,
      sourceRef: String(sourceRef || "codex/local-workspace-snapshot"),
      sourceSha,
      objectCount: entries.length,
      totalPlaintextBytes: entries.reduce((sum, entry) => sum + Number(entry.byteLength), 0),
      indexPackageSha256: encryptedIndex.packageSha256,
      database: { integrity: verifiedDb.integrity, foreignKeyViolations: verifiedDb.foreignKeyViolations },
      restoreDrill: "PENDING"
    };
    const manifestPath = path.join(setDir, "manifest.json");
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
    const drill = await verifyMachineRecoverySet(setDir, credentials);
    manifest.database = drill.database;
    manifest.restoreDrill = "PASS";
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    complete = true;
    return { setDir, manifestPath, manifest };
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
    if (!complete) fs.rmSync(setDir, { recursive: true, force: true });
  }
}

function targetForEntry(entry, { targetRoot, tunnelTokenTarget }) {
  if (entry.kind === "tunnel-token") {
    if (!tunnelTokenTarget) throw new Error("machine_recovery_tunnel_target_missing");
    return path.resolve(tunnelTokenTarget);
  }
  if (!entry.logicalPath.startsWith("data/")) throw new Error("machine_recovery_unknown_target");
  const relative = entry.logicalPath.slice("data/".length).split("/");
  const target = path.join(path.resolve(targetRoot), "data", ...relative);
  if (!pathInside(path.join(path.resolve(targetRoot), "data"), target)) throw new Error("machine_recovery_target_escape");
  return target;
}

function assertSourceCheckout(targetRoot, { allowBareTarget = false } = {}) {
  if (allowBareTarget) return;
  const required = ["package.json", "start-patap-stack.ps1", "Caddyfile.tunnel"];
  for (const name of required) if (!fs.existsSync(path.join(targetRoot, name))) throw new Error(`machine_recovery_source_checkout_missing:${name}`);
}

async function restoreMachineRecovery({
  setDir,
  targetRoot,
  tunnelTokenTarget = defaultTunnelTokenPath(),
  keyFile = process.env.PATAP_DR_KEY_FILE,
  passphrase = process.env.PATAP_DR_PASSPHRASE,
  confirm = process.env.PATAP_MACHINE_RECOVERY_CONFIRM,
  allowBareTarget = false
} = {}) {
  if (confirm !== "RESTORE") throw new Error("Set PATAP_MACHINE_RECOVERY_CONFIRM=RESTORE");
  if (!setDir) throw new Error("Set PATAP_MACHINE_DR_SET_DIR or provide a recovery set path");
  if (!targetRoot) throw new Error("Set PATAP_RECOVERY_TARGET_ROOT to the checked-out safe snapshot directory");
  const resolvedTargetRoot = path.resolve(targetRoot);
  fs.mkdirSync(resolvedTargetRoot, { recursive: true });
  assertSourceCheckout(resolvedTargetRoot, { allowBareTarget });
  const credentials = { keyFile, passphrase };
  await verifyMachineRecoverySet(setDir, credentials);
  const { index } = await readEncryptedIndex(path.resolve(setDir), credentials);
  const plans = index.entries.map((entry) => ({ entry, target: targetForEntry(entry, { targetRoot: resolvedTargetRoot, tunnelTokenTarget }) }));
  for (const plan of plans) if (fs.existsSync(plan.target)) throw new Error(`machine_recovery_refuses_overwrite:${plan.entry.logicalPath}`);
  const committed = [];
  try {
    const ordered = [...plans].sort((a, b) => (a.entry.kind === "database" ? 1 : 0) - (b.entry.kind === "database" ? 1 : 0));
    for (const plan of ordered) {
      fs.mkdirSync(path.dirname(plan.target), { recursive: true, mode: 0o700 });
      const temporary = `${plan.target}.recovering-${crypto.randomUUID()}`;
      const packagePath = path.join(path.resolve(setDir), "objects", `${plan.entry.id}.patapdr`);
      try {
        const restored = await decryptFile(packagePath, temporary, credentials);
        if (restored.plaintextSha256 !== plan.entry.plaintextSha256) throw new Error(`machine_recovery_plaintext_sha_mismatch:${plan.entry.id}`);
        if (plan.entry.kind === "database") verifySqlite(temporary);
        fs.chmodSync(temporary, 0o600);
        fs.renameSync(temporary, plan.target);
        committed.push(plan.target);
      } finally {
        fs.rmSync(temporary, { force: true });
      }
    }
    return { restored: committed.length, targetRoot: resolvedTargetRoot, database: "PASS", publicActivationRequired: true };
  } catch (error) {
    for (const target of committed.reverse()) fs.rmSync(target, { force: true });
    throw error;
  }
}

module.exports = {
  FORMAT,
  INDEX_FORMAT,
  ROOT,
  DEFAULT_DATA_ROOT,
  MAINTENANCE_FLAG,
  defaultTunnelTokenPath,
  normalizeLogicalPath,
  collectDataFiles,
  assertMaintenance,
  assertBackendOffline,
  buildSourceEntries,
  verifyMachineRecoverySet,
  exportMachineRecovery,
  restoreMachineRecovery
};
