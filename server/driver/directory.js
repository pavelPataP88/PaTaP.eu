function normalizeNickname(value) {
  return String(value || "").normalize("NFKC").trim().toLocaleLowerCase("und");
}

function createDriverDirectory(db, { addMinutes }) {
  function relationship(viewerId, driverId) {
    if (viewerId === driverId) return "SELF";
    if (db.prepare("SELECT 1 FROM driver_blocks WHERE blocker_id = ? AND blocked_id = ?").get(viewerId, driverId)) return "BLOCKED";
    const outgoing = db.prepare("SELECT status FROM driver_relationships WHERE requester_id = ? AND target_id = ?").get(viewerId, driverId);
    if (outgoing?.status === "ACCEPTED" || db.prepare("SELECT 1 FROM driver_relationships WHERE requester_id = ? AND target_id = ? AND status = 'ACCEPTED'").get(driverId, viewerId)) return "CONTACT";
    if (outgoing?.status === "PENDING") return "REQUEST_SENT";
    if (db.prepare("SELECT 1 FROM driver_relationships WHERE requester_id = ? AND target_id = ? AND status = 'PENDING'").get(driverId, viewerId)) return "REQUEST_INCOMING";
    return "STRANGER";
  }

  function blockedEitherWay(viewerId, driverId) {
    return Boolean(db.prepare(`SELECT 1 FROM driver_blocks
      WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?)`)
      .get(viewerId, driverId, driverId, viewerId));
  }

  function publicCard(row, viewerId) {
    if (!row) return null;
    const fresh = Boolean(row.location_updated_at && row.location_updated_at >= addMinutes(-1));
    return {
      nickname: row.nickname,
      driverType: row.driver_type,
      vehicle: row.vehicle,
      countryCode: row.country_code,
      gps: row.gps_enabled === 1 ? (fresh ? "ACTIVE" : "STALE") : "OFF",
      locationUpdatedAt: row.location_updated_at || null,
      relationship: relationship(viewerId, Number(row.user_id))
    };
  }

  function find(viewerId, nickname) {
    const key = normalizeNickname(nickname);
    if (!key) return null;
    const row = db.prepare(`
      SELECT p.user_id, p.nickname, p.driver_type, p.vehicle, p.country_code, p.gps_enabled,
             l.updated_at AS location_updated_at
      FROM driver_profiles p LEFT JOIN driver_locations l ON l.user_id = p.user_id
      WHERE p.nickname_key = ?
    `).get(key);
    if (!row) return null;
    // A driver may still open a person they blocked from Contacts in order to
    // review the state and unblock them. A block made by the other person
    // remains private and is not exposed through the directory.
    const driverId = Number(row.user_id);
    const blockedByViewer = Boolean(db.prepare("SELECT 1 FROM driver_blocks WHERE blocker_id = ? AND blocked_id = ?").get(viewerId, driverId));
    return !blockedEitherWay(viewerId, driverId) || blockedByViewer ? publicCard(row, viewerId) : null;
  }

  function search(viewerId, query) {
    const key = normalizeNickname(query);
    if (key.length < 2) return [];
    return db.prepare(`
      SELECT p.user_id, p.nickname, p.driver_type, p.vehicle, p.country_code, p.gps_enabled,
             l.updated_at AS location_updated_at
      FROM driver_profiles p LEFT JOIN driver_locations l ON l.user_id = p.user_id
      WHERE p.nickname_key LIKE ?
      ORDER BY p.nickname_key LIMIT 20
    `).all(`${key}%`).filter((row) => !blockedEitherWay(viewerId, Number(row.user_id))).map((row) => publicCard(row, viewerId));
  }

  function targetId(nickname) {
    const key = normalizeNickname(nickname);
    return key ? db.prepare("SELECT user_id FROM driver_profiles WHERE nickname_key = ?").get(key)?.user_id || null : null;
  }

  function requestContact(viewerId, nickname, now) {
    const driverId = Number(targetId(nickname));
    if (!driverId || driverId === viewerId) return null;
    if (blockedEitherWay(viewerId, driverId)) {
      const error = new Error("driver_blocked"); error.status = 409; throw error;
    }
    db.exec("BEGIN IMMEDIATE");
    try {
      const incoming = db.prepare("SELECT status FROM driver_relationships WHERE requester_id = ? AND target_id = ?").get(driverId, viewerId);
      const outgoing = db.prepare("SELECT status FROM driver_relationships WHERE requester_id = ? AND target_id = ?").get(viewerId, driverId);
      if (incoming?.status === "PENDING") {
        db.prepare("UPDATE driver_relationships SET status = 'ACCEPTED', updated_at = ? WHERE requester_id = ? AND target_id = ?").run(now, driverId, viewerId);
      } else if (!outgoing) {
        db.prepare("INSERT INTO driver_relationships(requester_id, target_id, status, created_at, updated_at) VALUES(?, ?, 'PENDING', ?, ?)").run(viewerId, driverId, now, now);
      }
      db.exec("COMMIT");
      return this.find(viewerId, nickname);
    } catch (error) {
      db.exec("ROLLBACK"); throw error;
    }
  }

  function setBlocked(viewerId, nickname, enabled, now) {
    const previousCard = this.find(viewerId, nickname);
    const driverId = Number(targetId(nickname));
    if (!driverId || driverId === viewerId) return null;
    db.exec("BEGIN IMMEDIATE");
    try {
      if (enabled) {
        db.prepare("DELETE FROM driver_relationships WHERE (requester_id = ? AND target_id = ?) OR (requester_id = ? AND target_id = ?)").run(viewerId, driverId, driverId, viewerId);
        db.prepare("INSERT INTO driver_blocks(blocker_id, blocked_id, created_at) VALUES(?, ?, ?) ON CONFLICT(blocker_id, blocked_id) DO NOTHING").run(viewerId, driverId, now);
      } else db.prepare("DELETE FROM driver_blocks WHERE blocker_id = ? AND blocked_id = ?").run(viewerId, driverId);
      db.exec("COMMIT");
      return enabled ? { ...previousCard, relationship: "BLOCKED" } : this.find(viewerId, nickname);
    } catch (error) {
      db.exec("ROLLBACK"); throw error;
    }
  }

  function declineContact(viewerId, nickname) {
    const driverId = Number(targetId(nickname));
    if (!driverId || driverId === viewerId) return null;
    db.prepare("DELETE FROM driver_relationships WHERE requester_id = ? AND target_id = ? AND status = 'PENDING'")
      .run(driverId, viewerId);
    return this.find(viewerId, nickname);
  }

  function removeContact(viewerId, nickname) {
    const driverId = Number(targetId(nickname));
    if (!driverId || driverId === viewerId) return null;
    db.prepare("DELETE FROM driver_relationships WHERE (requester_id = ? AND target_id = ?) OR (requester_id = ? AND target_id = ?)")
      .run(viewerId, driverId, driverId, viewerId);
    return this.find(viewerId, nickname);
  }

  function listRelationships(viewerId) {
    const ids = db.prepare(`SELECT target_id AS user_id FROM driver_relationships WHERE requester_id = ?
      UNION SELECT requester_id FROM driver_relationships WHERE target_id = ?
      UNION SELECT blocked_id FROM driver_blocks WHERE blocker_id = ?`).all(viewerId, viewerId, viewerId);
    const drivers = ids.map((item) => db.prepare("SELECT nickname FROM driver_profiles WHERE user_id = ?").get(item.user_id)?.nickname)
      .filter(Boolean).map((nickname) => {
        const row = db.prepare(`SELECT p.user_id, p.nickname, p.driver_type, p.vehicle, p.country_code, p.gps_enabled, l.updated_at AS location_updated_at FROM driver_profiles p LEFT JOIN driver_locations l ON l.user_id=p.user_id WHERE p.nickname=?`).get(nickname);
        return publicCard(row, viewerId);
      }).filter(Boolean)
      .sort((left, right) => left.nickname.localeCompare(right.nickname, "und"));
    const groups = { incoming: [], outgoing: [], contacts: [], blocked: [] };
    const groupByRelationship = {
      REQUEST_INCOMING: "incoming",
      REQUEST_SENT: "outgoing",
      CONTACT: "contacts",
      BLOCKED: "blocked"
    };
    for (const driver of drivers) {
      const group = groupByRelationship[driver.relationship];
      if (group) groups[group].push(driver);
    }
    return { drivers, groups };
  }

  return { find, search, requestContact, declineContact, removeContact, setBlocked, listRelationships };
}

module.exports = { createDriverDirectory };
