const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");

const { hashPassword: legacyHashPassword } = require("../../server/auth/db");
const { hashPassword, verifyPassword } = require("../../server/auth/password");

test("async password KDF preserves existing scrypt format without using scryptSync", async () => {
  const password = "AsyncPassword123!";
  const legacyEncoded = legacyHashPassword(password);
  const originalScryptSync = crypto.scryptSync;
  crypto.scryptSync = () => { throw new Error("scryptSync must not be used by async password KDF"); };
  try {
    const eventLoopTick = new Promise((resolve) => setImmediate(resolve));
    const encodedPromise = hashPassword(password);
    await eventLoopTick;
    const encoded = await encodedPromise;

    assert.match(encoded, /^scrypt\$v=1\$N=32768\$r=8\$p=1\$[0-9a-f]{32}\$[0-9a-f]{128}$/);
    assert.equal(await verifyPassword(password, encoded), true);
    assert.equal(await verifyPassword("wrong-password", encoded), false);
    assert.equal(await verifyPassword(password, legacyEncoded), true);
    assert.equal(await verifyPassword(password, "not-a-scrypt-hash"), false);
  } finally {
    crypto.scryptSync = originalScryptSync;
  }
});
