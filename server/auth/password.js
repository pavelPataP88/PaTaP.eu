const crypto = require("crypto");

const SCRYPT_OPTIONS = Object.freeze({
  N: 32768,
  r: 8,
  p: 1,
  maxmem: 64 * 1024 * 1024
});

function deriveScrypt(password, salt, keyLength, options) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, keyLength, options, (error, derivedKey) => {
      if (error) reject(error);
      else resolve(derivedKey);
    });
  });
}

async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const derived = await deriveScrypt(password, salt, 64, SCRYPT_OPTIONS);
  return `scrypt$v=1$N=${SCRYPT_OPTIONS.N}$r=${SCRYPT_OPTIONS.r}$p=${SCRYPT_OPTIONS.p}$${salt}$${derived.toString("hex")}`;
}

async function verifyPassword(password, encoded) {
  try {
    const parts = String(encoded || "").split("$");
    if (parts[0] !== "scrypt") return false;
    const params = Object.fromEntries(parts.slice(2, 5).map((part) => part.split("=")));
    const salt = parts[5];
    const expected = Buffer.from(parts[6] || "", "hex");
    if (!salt || expected.length === 0) return false;
    const actual = await deriveScrypt(password, salt, expected.length, {
      N: Number(params.N),
      r: Number(params.r),
      p: Number(params.p),
      maxmem: SCRYPT_OPTIONS.maxmem
    });
    return actual.length === expected.length && crypto.timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

module.exports = {
  SCRYPT_OPTIONS,
  hashPassword,
  verifyPassword
};
