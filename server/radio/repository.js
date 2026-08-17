const crypto = require("crypto");

const LEASE_SECONDS = 75;
const TRANSMISSION_RETENTION_DAYS = 30;

function addSeconds(now, seconds) {
  return new Date(new Date(now).getTime() + seconds * 1000).toISOString();
}

function addDays(now, days) {
  return new Date(new Date(now).getTime() + days * 24 * 60 * 60 * 1000).toISOString();
}

function normalizeNickname(value) {
  return String(value || "").normalize("NFKC").trim().toLocaleLowerCase("und");
}

function publicTransmission(row) {
  return {
    id: Number(row.id),
    channelId: Number(row.channel_id),
    sender: { nickname: row.nickname, driverType: row.driver_type },
    mimeType: row.mime_type,
    byteLength: Number(row.byte_length),
    createdAt: row.created_at,
    committedAt: row.committed_at
  };
}

function createRadioRepository(db, { hashToken, randomToken }) {
  function hasProfile(userId) {
    return Boolean(db.prepare("SELECT 1 FROM driver_profiles WHERE user_id = ?").get(userId));
  }

  function areBlocked(leftUserId, rightUserId) {
    return Boolean(db.prepare(`SELECT 1 FROM driver_blocks
      WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?)`)
      .get(leftUserId, rightUserId, rightUserId, leftUserId));
  }

  function areContacts(leftUserId, rightUserId) {
    return Boolean(db.prepare(`SELECT 1 FROM driver_relationships
      WHERE status = 'ACCEPTED' AND ((requester_id = ? AND target_id = ?) OR (requester_id = ? AND target_id = ?))`)
      .get(leftUserId, rightUserId, rightUserId, leftUserId));
  }

  function accessError(userId, channelId) {
    const member = db.prepare("SELECT 1 FROM radio_channel_members WHERE channel_id = ? AND user_id = ?").get(channelId, userId);
    if (!member || !hasProfile(userId)) return "radio_channel_not_found";
    const peer = db.prepare(`SELECT user_id FROM radio_channel_members
      WHERE channel_id = ? AND user_id != ? LIMIT 1`).get(channelId, userId);
    return peer && areBlocked(userId, Number(peer.user_id)) ? "driver_blocked" : null;
  }

  function channelRowForUser(userId, channelId, now) {
    const row = db.prepare(`
      SELECT c.id, c.channel_key, c.kind, c.created_at,
        peer.nickname AS peer_nickname, peer.driver_type AS peer_driver_type,
        lease.speaker_id, speaker.nickname AS speaker_nickname, lease.expires_at,
        (SELECT MAX(id) FROM radio_transmissions t WHERE t.channel_id = c.id AND t.state = 'COMMITTED') AS last_transmission_id,
        (SELECT COUNT(*) FROM radio_transmissions t WHERE t.channel_id = c.id AND t.state = 'COMMITTED') AS transmission_count
      FROM radio_channels c
      JOIN radio_channel_members mine ON mine.channel_id = c.id AND mine.user_id = ?
      LEFT JOIN radio_channel_members peer_member ON peer_member.channel_id = c.id AND peer_member.user_id != ?
      LEFT JOIN driver_profiles peer ON peer.user_id = peer_member.user_id
      LEFT JOIN radio_speaker_leases lease ON lease.channel_id = c.id AND lease.expires_at > ?
      LEFT JOIN driver_profiles speaker ON speaker.user_id = lease.speaker_id
      WHERE c.id = ?
    `).get(userId, userId, now, channelId);
    if (!row) return null;
    return {
      id: Number(row.id), key: row.channel_key, kind: row.kind,
      title: row.peer_nickname || "Рация",
      peer: row.peer_nickname ? { nickname: row.peer_nickname, driverType: row.peer_driver_type } : null,
      speaker: row.speaker_id === null ? null : { nickname: row.speaker_nickname, isSelf: Number(row.speaker_id) === userId, expiresAt: row.expires_at },
      lastTransmissionId: row.last_transmission_id === null ? null : Number(row.last_transmission_id),
      transmissionCount: Number(row.transmission_count),
      createdAt: row.created_at
    };
  }

  function createDirectChannel(userId, nickname, now) {
    const target = db.prepare("SELECT user_id FROM driver_profiles WHERE nickname_key = ?").get(normalizeNickname(nickname));
    if (!target) return { error: "driver_not_found", status: 404 };
    const targetId = Number(target.user_id);
    if (targetId === userId) return { error: "radio_self_forbidden", status: 400 };
    if (areBlocked(userId, targetId)) return { error: "driver_blocked", status: 403 };
    if (!areContacts(userId, targetId)) return { error: "radio_contact_required", status: 403 };
    const [firstUserId, secondUserId] = [userId, targetId].sort((a, b) => a - b);
    db.exec("BEGIN IMMEDIATE");
    try {
      let pair = db.prepare("SELECT channel_id FROM radio_direct_pairs WHERE first_user_id = ? AND second_user_id = ?")
        .get(firstUserId, secondUserId);
      let created = false;
      if (!pair) {
        const result = db.prepare("INSERT INTO radio_channels(channel_key, kind, created_at) VALUES(?, 'DIRECT', ?)")
          .run(`direct:${firstUserId}:${secondUserId}`, now);
        const channelId = Number(result.lastInsertRowid);
        const addMember = db.prepare("INSERT INTO radio_channel_members(channel_id, user_id, joined_at) VALUES(?, ?, ?)");
        addMember.run(channelId, firstUserId, now);
        addMember.run(channelId, secondUserId, now);
        db.prepare("INSERT INTO radio_direct_pairs(first_user_id, second_user_id, channel_id, created_at) VALUES(?, ?, ?, ?)")
          .run(firstUserId, secondUserId, channelId, now);
        pair = { channel_id: channelId };
        created = true;
      }
      const channel = channelRowForUser(userId, Number(pair.channel_id), now);
      db.exec("COMMIT");
      return { channel, created };
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  function listChannels(userId, now) {
    db.prepare("DELETE FROM radio_speaker_leases WHERE expires_at <= ?").run(now);
    return db.prepare("SELECT channel_id FROM radio_channel_members WHERE user_id = ? ORDER BY channel_id DESC").all(userId)
      .map((row) => channelRowForUser(userId, Number(row.channel_id), now))
      .filter((channel) => channel && !accessError(userId, channel.id));
  }

  function beginTransmission(userId, channelId, now) {
    const access = accessError(userId, channelId);
    if (access) return { error: access, status: access === "driver_blocked" ? 403 : 404 };
    db.exec("BEGIN IMMEDIATE");
    try {
      db.prepare("DELETE FROM radio_speaker_leases WHERE channel_id = ? AND expires_at <= ?").run(channelId, now);
      const active = db.prepare(`SELECT l.speaker_id, p.nickname FROM radio_speaker_leases l
        JOIN driver_profiles p ON p.user_id = l.speaker_id WHERE l.channel_id = ?`).get(channelId);
      if (active) {
        db.exec("COMMIT");
        return { error: "radio_channel_busy", status: 409, speaker: active.nickname };
      }
      const uploadToken = randomToken(32);
      const storageKey = crypto.randomUUID().replaceAll("-", "");
      const expiresAt = addSeconds(now, LEASE_SECONDS);
      const transmission = db.prepare(`INSERT INTO radio_transmissions(
        channel_id, sender_id, upload_token_hash, storage_key, state, created_at, expires_at
      ) VALUES(?, ?, ?, ?, 'UPLOADING', ?, ?)`)
        .run(channelId, userId, hashToken(uploadToken), storageKey, now, addSeconds(now, LEASE_SECONDS));
      db.prepare("INSERT INTO radio_speaker_leases(channel_id, speaker_id, upload_token_hash, expires_at) VALUES(?, ?, ?, ?)")
        .run(channelId, userId, hashToken(uploadToken), expiresAt);
      db.exec("COMMIT");
      return { transmissionId: Number(transmission.lastInsertRowid), uploadToken, expiresAt };
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  function uploadTarget(userId, transmissionId, uploadToken, now) {
    const row = db.prepare(`SELECT t.*, l.speaker_id, l.expires_at AS lease_expires_at, l.upload_token_hash AS lease_token_hash
      FROM radio_transmissions t LEFT JOIN radio_speaker_leases l ON l.channel_id = t.channel_id
      WHERE t.id = ?`).get(transmissionId);
    if (!row || Number(row.sender_id) !== userId || row.state !== "UPLOADING" || row.expires_at <= now ||
      row.speaker_id !== userId || row.lease_expires_at <= now || !uploadToken ||
      hashToken(uploadToken) !== row.upload_token_hash || hashToken(uploadToken) !== row.lease_token_hash) {
      return null;
    }
    if (accessError(userId, Number(row.channel_id))) return null;
    return row;
  }

  function commitUpload(userId, transmissionId, uploadToken, { mimeType, byteLength }, now) {
    const row = uploadTarget(userId, transmissionId, uploadToken, now);
    if (!row) return null;
    db.exec("BEGIN IMMEDIATE");
    try {
      const changed = db.prepare(`UPDATE radio_transmissions SET state = 'COMMITTED', mime_type = ?, byte_length = ?, committed_at = ?, expires_at = ?
        WHERE id = ? AND state = 'UPLOADING' AND upload_token_hash = ?`).run(mimeType, byteLength, now, addDays(now, TRANSMISSION_RETENTION_DAYS), transmissionId, hashToken(uploadToken)).changes;
      if (changed !== 1) throw new Error("radio_transmission_conflict");
      db.prepare("DELETE FROM radio_speaker_leases WHERE channel_id = ? AND upload_token_hash = ?").run(row.channel_id, hashToken(uploadToken));
      const committed = db.prepare(`SELECT t.*, p.nickname, p.driver_type FROM radio_transmissions t
        JOIN driver_profiles p ON p.user_id = t.sender_id WHERE t.id = ?`).get(transmissionId);
      db.exec("COMMIT");
      return publicTransmission(committed);
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  function cancelTransmission(userId, transmissionId, uploadToken) {
    db.exec("BEGIN IMMEDIATE");
    try {
      const row = db.prepare("SELECT channel_id FROM radio_transmissions WHERE id = ? AND sender_id = ? AND state = 'UPLOADING' AND upload_token_hash = ?")
        .get(transmissionId, userId, hashToken(uploadToken));
      if (!row) {
        db.exec("COMMIT");
        return false;
      }
      db.prepare("DELETE FROM radio_speaker_leases WHERE channel_id = ? AND speaker_id = ? AND upload_token_hash = ?")
        .run(row.channel_id, userId, hashToken(uploadToken));
      const deleted = db.prepare("DELETE FROM radio_transmissions WHERE id = ? AND sender_id = ? AND state = 'UPLOADING' AND upload_token_hash = ?")
        .run(transmissionId, userId, hashToken(uploadToken)).changes;
      db.exec("COMMIT");
      return deleted === 1;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  function listTransmissions(userId, channelId, now, limit = 30) {
    const access = accessError(userId, channelId);
    if (access) return { error: access };
    const rows = db.prepare(`SELECT t.*, p.nickname, p.driver_type FROM radio_transmissions t
      JOIN driver_profiles p ON p.user_id = t.sender_id
      WHERE t.channel_id = ? AND t.state = 'COMMITTED' AND t.expires_at > ?
      ORDER BY t.id DESC LIMIT ?`).all(channelId, now, limit);
    return { transmissions: rows.reverse().map(publicTransmission) };
  }

  function audioForUser(userId, transmissionId, now) {
    const row = db.prepare(`SELECT t.*, p.nickname, p.driver_type FROM radio_transmissions t
      JOIN driver_profiles p ON p.user_id = t.sender_id WHERE t.id = ?`).get(transmissionId);
    if (!row || row.state !== "COMMITTED" || row.expires_at <= now || accessError(userId, Number(row.channel_id))) return null;
    return row;
  }

  function committedDeletionTarget(userId, transmissionId) {
    return db.prepare(`SELECT id, channel_id, storage_key FROM radio_transmissions
      WHERE id = ? AND sender_id = ? AND state = 'COMMITTED'`).get(transmissionId, userId) || null;
  }

  function deleteCommittedTransmission(userId, transmissionId) {
    return db.prepare(`DELETE FROM radio_transmissions
      WHERE id = ? AND sender_id = ? AND state = 'COMMITTED'`).run(transmissionId, userId).changes === 1;
  }

  return {
    hasProfile, createDirectChannel, listChannels, beginTransmission, uploadTarget, commitUpload,
    cancelTransmission, listTransmissions, audioForUser, committedDeletionTarget, deleteCommittedTransmission
  };
}

module.exports = { createRadioRepository, LEASE_SECONDS };
