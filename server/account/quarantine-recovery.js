const fs = require("node:fs");
const path = require("node:path");

const PENDING_PATTERN = /^(.*)\.account-delete-[0-9a-f-]+\.pending$/i;

function tableExists(db, name) {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name=?").get(name));
}

function isReferenced(db, kind, storageKey) {
  if (kind === "chat") {
    return (tableExists(db, "chat_uploads") && Boolean(db.prepare("SELECT 1 FROM chat_uploads WHERE storage_key=? LIMIT 1").get(storageKey)))
      || (tableExists(db, "chat_message_attachments") && Boolean(db.prepare("SELECT 1 FROM chat_message_attachments WHERE storage_key=? LIMIT 1").get(storageKey)));
  }
  if (kind === "radio") {
    return tableExists(db, "radio_transmissions") && Boolean(db.prepare("SELECT 1 FROM radio_transmissions WHERE storage_key=? LIMIT 1").get(storageKey));
  }
  if (kind === "parking") {
    return tableExists(db, "parking_photos") && Boolean(db.prepare("SELECT 1 FROM parking_photos WHERE storage_key=? LIMIT 1").get(storageKey));
  }
  return false;
}

function reconcileDeletionQuarantine(db, dataDir) {
  const result = { restored: 0, removed: 0, failed: 0 };
  for (const kind of ["chat", "radio", "parking"]) {
    const directory = path.join(dataDir, kind);
    if (!fs.existsSync(directory)) continue;
    let entries;
    try { entries = fs.readdirSync(directory, { withFileTypes: true }); }
    catch { result.failed += 1; continue; }

    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const match = entry.name.match(PENDING_PATTERN);
      if (!match) continue;
      const storageKey = match[1];
      if (!storageKey || path.basename(storageKey) !== storageKey || /[\\/\u0000-\u001f\u007f]/.test(storageKey)) {
        result.failed += 1;
        continue;
      }
      const pending = path.join(directory, entry.name);
      const original = path.join(directory, storageKey);
      try {
        if (isReferenced(db, kind, storageKey)) {
          if (fs.existsSync(original)) {
            fs.rmSync(pending, { force: true });
            result.removed += 1;
          } else {
            fs.renameSync(pending, original);
            result.restored += 1;
          }
        } else {
          fs.rmSync(pending, { force: true });
          result.removed += 1;
        }
      } catch {
        result.failed += 1;
      }
    }
  }
  return result;
}

module.exports = { PENDING_PATTERN, isReferenced, reconcileDeletionQuarantine };
