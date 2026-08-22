const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { pipeline } = require("node:stream/promises");
const { DatabaseSync } = require("node:sqlite");

const MAGIC = "PATAP-DR1\n";
const TAG_BYTES = 16;

async function sha256File(filePath) {
  const hash = crypto.createHash("sha256");
  await pipeline(fs.createReadStream(filePath), hash);
  return hash.digest("hex");
}

function resolveKey({ keyFile = process.env.PATAP_DR_KEY_FILE, passphrase = process.env.PATAP_DR_PASSPHRASE, salt } = {}) {
  if (keyFile) {
    const bytes = fs.readFileSync(path.resolve(keyFile));
    if (bytes.length < 32) throw new Error("PATAP_DR_KEY_FILE must contain at least 32 bytes of secret material");
    return { key: crypto.createHash("sha256").update(bytes).digest(), kdf: "sha256-keyfile" };
  }
  const secret = String(passphrase || "");
  if (secret.length < 16) throw new Error("Set PATAP_DR_KEY_FILE or a PATAP_DR_PASSPHRASE of at least 16 characters");
  return {
    key: crypto.scryptSync(secret, salt, 32, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }),
    kdf: "scrypt-N16384-r8-p1"
  };
}

function assertDifferentDevice(sourcePath, destinationDir, { allowSameDevice = process.env.PATAP_DR_ALLOW_SAME_DEVICE === "YES" } = {}) {
  fs.mkdirSync(destinationDir, { recursive: true, mode: 0o700 });
  const sourceReal = fs.realpathSync(path.dirname(path.resolve(sourcePath)));
  const destinationReal = fs.realpathSync(path.resolve(destinationDir));
  if (destinationReal === sourceReal || destinationReal.startsWith(`${sourceReal}${path.sep}`)) {
    if (!allowSameDevice) throw new Error("DR destination must not be inside the live database directory");
  }
  const sourceDevice = fs.statSync(sourceReal).dev;
  const destinationDevice = fs.statSync(destinationReal).dev;
  if (sourceDevice === destinationDevice && !allowSameDevice) {
    throw new Error("DR destination is on the same filesystem/device. Use a second device or network share.");
  }
  return destinationReal;
}

async function encryptFile(sourcePath, packagePath, credentials = {}) {
  const source = path.resolve(sourcePath);
  const target = path.resolve(packagePath);
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const plaintextSha256 = await sha256File(source);
  const { key, kdf } = resolveKey({ ...credentials, salt });
  const header = {
    version: 1,
    cipher: "aes-256-gcm",
    kdf,
    salt: salt.toString("base64url"),
    iv: iv.toString("base64url"),
    plaintextSha256,
    createdAt: new Date().toISOString()
  };
  fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  const prefix = Buffer.from(`${MAGIC}${JSON.stringify(header)}\n`, "utf8");
  const fd = fs.openSync(target, "wx", 0o600);
  try { fs.writeSync(fd, prefix); } finally { fs.closeSync(fd); }
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv, { authTagLength: TAG_BYTES });
  await pipeline(fs.createReadStream(source), cipher, fs.createWriteStream(target, { flags: "a", mode: 0o600 }));
  fs.appendFileSync(target, cipher.getAuthTag());
  return { header, packagePath: target, packageSha256: await sha256File(target) };
}

function readHeader(packagePath) {
  const fd = fs.openSync(packagePath, "r");
  try {
    const max = Math.min(64 * 1024, fs.fstatSync(fd).size);
    const buffer = Buffer.alloc(max);
    const bytes = fs.readSync(fd, buffer, 0, max, 0);
    const text = buffer.subarray(0, bytes).toString("utf8");
    if (!text.startsWith(MAGIC)) throw new Error("Invalid PaTaP DR package magic");
    const newline = text.indexOf("\n", MAGIC.length);
    if (newline < 0) throw new Error("Invalid PaTaP DR package header");
    const header = JSON.parse(text.slice(MAGIC.length, newline));
    if (header.version !== 1 || header.cipher !== "aes-256-gcm") throw new Error("Unsupported PaTaP DR package version");
    return { header, bodyOffset: Buffer.byteLength(text.slice(0, newline + 1), "utf8") };
  } finally { fs.closeSync(fd); }
}

async function decryptFile(packagePath, targetPath, credentials = {}) {
  const source = path.resolve(packagePath);
  const target = path.resolve(targetPath);
  const stat = fs.statSync(source);
  const { header, bodyOffset } = readHeader(source);
  if (stat.size < bodyOffset + TAG_BYTES) throw new Error("PaTaP DR package is truncated");
  const salt = Buffer.from(header.salt, "base64url");
  const iv = Buffer.from(header.iv, "base64url");
  const { key, kdf } = resolveKey({ ...credentials, salt });
  if (kdf !== header.kdf) throw new Error("DR key method does not match package metadata");
  const tag = Buffer.alloc(TAG_BYTES);
  const fd = fs.openSync(source, "r");
  try { fs.readSync(fd, tag, 0, TAG_BYTES, stat.size - TAG_BYTES); } finally { fs.closeSync(fd); }
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv, { authTagLength: TAG_BYTES });
  decipher.setAuthTag(tag);
  fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  try {
    const ciphertextEnd = stat.size - TAG_BYTES - 1;
    if (ciphertextEnd < bodyOffset) {
      const plaintext = decipher.final();
      fs.writeFileSync(target, plaintext, { flags: "wx", mode: 0o600 });
    } else {
      await pipeline(
        fs.createReadStream(source, { start: bodyOffset, end: ciphertextEnd }),
        decipher,
        fs.createWriteStream(target, { flags: "wx", mode: 0o600 })
      );
    }
  } catch (error) {
    fs.rmSync(target, { force: true });
    throw new Error(`DR package decryption failed: ${error.message}`);
  }
  const actual = await sha256File(target);
  if (actual !== header.plaintextSha256) {
    fs.rmSync(target, { force: true });
    throw new Error("DR package plaintext SHA-256 mismatch");
  }
  return { header, targetPath: target, plaintextSha256: actual };
}

function verifySqlite(filePath) {
  const db = new DatabaseSync(filePath, { readOnly: true });
  try {
    const integrity = db.prepare("PRAGMA integrity_check").get()?.integrity_check;
    if (integrity !== "ok") throw new Error(`SQLite integrity_check failed: ${integrity || "unknown"}`);
    const foreignKeys = db.prepare("PRAGMA foreign_key_check").all();
    if (foreignKeys.length) throw new Error(`SQLite foreign_key_check failed with ${foreignKeys.length} row(s)`);
    const migration = db.prepare("SELECT MAX(version) AS version FROM schema_migrations").get();
    return { integrity: "ok", foreignKeyViolations: 0, authSchemaVersion: Number(migration?.version || 0) };
  } finally { db.close(); }
}

async function verifyPackage(packagePath, temporarySqlitePath, credentials = {}) {
  const restored = await decryptFile(packagePath, temporarySqlitePath, credentials);
  try {
    return { ...restored, sqlite: verifySqlite(temporarySqlitePath), packageSha256: await sha256File(packagePath) };
  } finally {
    fs.rmSync(temporarySqlitePath, { force: true });
  }
}

module.exports = {
  MAGIC,
  TAG_BYTES,
  sha256File,
  assertDifferentDevice,
  encryptFile,
  decryptFile,
  verifySqlite,
  verifyPackage
};
