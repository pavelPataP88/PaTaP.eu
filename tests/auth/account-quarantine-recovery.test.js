const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { reconcileDeletionQuarantine } = require("../../server/account/quarantine-recovery");

test("account deletion quarantine restores referenced media after a pre-commit crash and removes committed orphans", () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "patap-account-quarantine-"));
  const chatDir = path.join(dataDir, "chat");
  fs.mkdirSync(chatDir, { recursive: true });
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE chat_uploads(storage_key TEXT NOT NULL)");
  db.exec("CREATE TABLE chat_message_attachments(storage_key TEXT NOT NULL)");
  db.exec("CREATE TABLE radio_transmissions(storage_key TEXT)");
  db.exec("CREATE TABLE parking_photos(storage_key TEXT)");

  try {
    const referenced = "referenced.bin";
    const referencedPending = path.join(chatDir, `${referenced}.account-delete-123e4567-e89b-12d3-a456-426614174000.pending`);
    fs.writeFileSync(referencedPending, "restore-me");
    db.prepare("INSERT INTO chat_uploads(storage_key) VALUES(?)").run(referenced);

    const orphan = "orphan.bin";
    const orphanPending = path.join(chatDir, `${orphan}.account-delete-223e4567-e89b-12d3-a456-426614174000.pending`);
    fs.writeFileSync(orphanPending, "delete-me");

    let result = reconcileDeletionQuarantine(db, dataDir);
    assert.deepEqual(result, { restored: 1, removed: 1, failed: 0 });
    assert.equal(fs.readFileSync(path.join(chatDir, referenced), "utf8"), "restore-me");
    assert.equal(fs.existsSync(referencedPending), false);
    assert.equal(fs.existsSync(orphanPending), false);

    db.prepare("DELETE FROM chat_uploads WHERE storage_key=?").run(referenced);
    const committedPending = path.join(chatDir, `${referenced}.account-delete-323e4567-e89b-12d3-a456-426614174000.pending`);
    fs.renameSync(path.join(chatDir, referenced), committedPending);
    result = reconcileDeletionQuarantine(db, dataDir);
    assert.deepEqual(result, { restored: 0, removed: 1, failed: 0 });
    assert.equal(fs.existsSync(committedPending), false);
    assert.equal(fs.existsSync(path.join(chatDir, referenced)), false);
  } finally {
    db.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
