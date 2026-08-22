const { ensureRoadReportSchema } = require("./schema");

const REPORT_TYPES = Object.freeze({
  ACCIDENT: { ttlMinutes: 60, label: "ДТП", lanes: true },
  ROADWORK: { ttlMinutes: 180, label: "Дорожные работы", lanes: true },
  OBSTACLE: { ttlMinutes: 45, label: "Препятствие", lanes: false },
  ROAD_CONTROL: { ttlMinutes: 30, label: "Дорожный контроль", lanes: false },
  TRANSPORT_INSPECTION: { ttlMinutes: 30, label: "Транспортная инспекция", lanes: false }
});
const REPORT_LANES = new Set(["ALL", "LEFT", "MIDDLE", "RIGHT", "SHOULDER"]);
const CONFIRMATIONS = new Set(["ACTIVE", "GONE"]);
const MAX_REPORT_DISTANCE_KM = 2;
const ROAD_REPORT_RETENTION_DAYS = 7;

const INDEPENDENT_CONFIRMATIONS_REQUIRED = 2;
const FAST_DISPUTE_MINUTES = 10;
const ABUSE_SCORE_DECAY_DAYS = 7;
const RESTRICTION_SCORE = 3;
const ESCALATED_RESTRICTION_SCORE = 5;
const RESTRICTION_HOURS = 6;
const ESCALATED_RESTRICTION_HOURS = 24;
const MAX_ABUSE_SCORE = 10;

function haversineKm(fromLat, fromLon, toLat, toLon) {
  const radians = (degrees) => degrees * Math.PI / 180;
  const earthKm = 6371.0088;
  const latDelta = radians(toLat - fromLat);
  const lonDelta = radians(toLon - fromLon);
  const a = Math.sin(latDelta / 2) ** 2 +
    Math.cos(radians(fromLat)) * Math.cos(radians(toLat)) * Math.sin(lonDelta / 2) ** 2;
  return earthKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function normalizeInput(input) {
  const type = String(input?.type || "").toUpperCase();
  const config = REPORT_TYPES[type];
  const latitude = input?.latitude;
  const longitude = input?.longitude;
  if (!config || typeof latitude !== "number" || !Number.isFinite(latitude) || latitude < -90 || latitude > 90 ||
      typeof longitude !== "number" || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) return null;
  const lane = input?.lane == null || input.lane === "" ? null : String(input.lane).toUpperCase();
  if (config.lanes) {
    if (lane !== null && !REPORT_LANES.has(lane)) return null;
  } else if (lane !== null) {
    return null;
  }
  return { type, lane, latitude, longitude };
}

function trustState(row) {
  const independentActive = Number(row?.independent_active_confirmations || 0);
  const independentGone = Number(row?.independent_gone_confirmations || 0);
  if (row?.closed_at && independentGone >= INDEPENDENT_CONFIRMATIONS_REQUIRED) return "DISPUTED";
  if (independentActive >= INDEPENDENT_CONFIRMATIONS_REQUIRED) return "CONFIRMED";
  if (independentActive > 0) return "SUPPORTED";
  return "UNCONFIRMED";
}

function publicRow(row) {
  if (!row) return null;
  const independentActive = Number(row.independent_active_confirmations || 0);
  const independentGone = Number(row.independent_gone_confirmations || 0);
  return {
    id: Number(row.id),
    type: row.type,
    lane: row.lane,
    latitude: Number(row.latitude),
    longitude: Number(row.longitude),
    createdAt: new Date(row.created_at).toISOString(),
    expiresAt: new Date(row.expires_at).toISOString(),
    confirmations: {
      active: Number(row.active_confirmations || 0),
      gone: Number(row.gone_confirmations || 0)
    },
    trust: {
      state: trustState(row),
      independentActive,
      independentGone
    }
  };
}

function addMinutesIso(iso, minutes) {
  return new Date(Date.parse(iso) + minutes * 60 * 1000).toISOString();
}

function addHoursIso(iso, hours) {
  return new Date(Date.parse(iso) + hours * 60 * 60 * 1000).toISOString();
}

function addDaysIso(iso, days) {
  return new Date(Date.parse(iso) + days * 24 * 60 * 60 * 1000).toISOString();
}

function effectiveAbuseScore(row, now) {
  const score = Math.max(0, Number(row?.abuse_score || 0));
  const last = Date.parse(row?.last_abuse_at || "");
  const current = Date.parse(now);
  if (!Number.isFinite(last) || !Number.isFinite(current) || current <= last) return score;
  const decayPeriods = Math.floor((current - last) / (ABUSE_SCORE_DECAY_DAYS * 24 * 60 * 60 * 1000));
  return Math.max(0, score - decayPeriods);
}

function maxFutureIso(first, second, now) {
  const nowMs = Date.parse(now);
  const candidates = [first, second]
    .filter(Boolean)
    .map((value) => ({ value, ms: Date.parse(value) }))
    .filter((item) => Number.isFinite(item.ms) && item.ms > nowMs)
    .sort((a, b) => b.ms - a.ms);
  return candidates[0]?.value || null;
}

function createRoadReportRepository(db, { nowIso = () => new Date().toISOString() } = {}) {
  ensureRoadReportSchema(db, nowIso());

  const publicSelect = `
    SELECT r.*,
      COALESCE(SUM(CASE WHEN v.status = 'ACTIVE' THEN 1 ELSE 0 END), 0) AS active_confirmations,
      COALESCE(SUM(CASE WHEN v.status = 'GONE' THEN 1 ELSE 0 END), 0) AS gone_confirmations,
      COALESCE(SUM(CASE WHEN v.status = 'ACTIVE' AND (r.author_id IS NULL OR v.user_id <> r.author_id) THEN 1 ELSE 0 END), 0) AS independent_active_confirmations,
      COALESCE(SUM(CASE WHEN v.status = 'GONE' AND (r.author_id IS NULL OR v.user_id <> r.author_id) THEN 1 ELSE 0 END), 0) AS independent_gone_confirmations
    FROM road_reports r
    LEFT JOIN road_report_votes v ON v.report_id = r.id
  `;

  const selectPublicById = db.prepare(`${publicSelect} WHERE r.id = ? GROUP BY r.id`);

  function prune(now = nowIso()) {
    const cutoff = addDaysIso(now, -ROAD_REPORT_RETENTION_DAYS);
    return Number(db.prepare(`
      DELETE FROM road_reports
      WHERE (closed_at IS NOT NULL AND closed_at <= ?)
         OR (closed_at IS NULL AND expires_at <= ?)
    `).run(cutoff, cutoff).changes || 0);
  }

  function activeRow(reportId, now = nowIso()) {
    return db.prepare(`
      SELECT id, author_id, type, lane, latitude, longitude, created_at, expires_at, closed_at,
             peer_supported_at, abuse_counted_at
      FROM road_reports
      WHERE id = ? AND closed_at IS NULL AND expires_at > ?
    `).get(reportId, now) || null;
  }

  function voteSummary(reportId, authorId) {
    return db.prepare(`
      SELECT
        COALESCE(SUM(CASE WHEN status = 'ACTIVE' THEN 1 ELSE 0 END), 0) AS active,
        COALESCE(SUM(CASE WHEN status = 'GONE' THEN 1 ELSE 0 END), 0) AS gone,
        COALESCE(SUM(CASE WHEN status = 'ACTIVE' AND (? IS NULL OR user_id <> ?) THEN 1 ELSE 0 END), 0) AS independent_active,
        COALESCE(SUM(CASE WHEN status = 'GONE' AND (? IS NULL OR user_id <> ?) THEN 1 ELSE 0 END), 0) AS independent_gone
      FROM road_report_votes
      WHERE report_id = ?
    `).get(authorId, authorId, authorId, authorId, reportId);
  }

  function recordAbuse(userId, now) {
    if (!Number.isSafeInteger(Number(userId))) return null;
    const existing = db.prepare(`
      SELECT user_id, abuse_score, restriction_until, last_abuse_at, updated_at
      FROM road_report_user_guard WHERE user_id = ?
    `).get(userId);
    const score = Math.min(MAX_ABUSE_SCORE, effectiveAbuseScore(existing, now) + 1);
    let proposedRestriction = null;
    if (score >= ESCALATED_RESTRICTION_SCORE) proposedRestriction = addHoursIso(now, ESCALATED_RESTRICTION_HOURS);
    else if (score >= RESTRICTION_SCORE) proposedRestriction = addHoursIso(now, RESTRICTION_HOURS);
    const restrictionUntil = maxFutureIso(existing?.restriction_until, proposedRestriction, now);
    db.prepare(`
      INSERT INTO road_report_user_guard(user_id, abuse_score, restriction_until, last_abuse_at, updated_at)
      VALUES(?, ?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        abuse_score = excluded.abuse_score,
        restriction_until = excluded.restriction_until,
        last_abuse_at = excluded.last_abuse_at,
        updated_at = excluded.updated_at
    `).run(userId, score, restrictionUntil, now, now);
    return { score, restrictionUntil };
  }

  function creationGuard(userId, now = nowIso()) {
    const row = db.prepare(`
      SELECT user_id, abuse_score, restriction_until, last_abuse_at
      FROM road_report_user_guard WHERE user_id = ?
    `).get(userId);
    const abuseScore = effectiveAbuseScore(row, now);
    const restrictionMs = Date.parse(row?.restriction_until || "");
    const nowMs = Date.parse(now);
    const restricted = Number.isFinite(restrictionMs) && Number.isFinite(nowMs) && restrictionMs > nowMs;
    return {
      allowed: !restricted,
      abuseScore,
      restrictedUntil: restricted ? new Date(restrictionMs).toISOString() : null,
      retryAfterSeconds: restricted ? Math.max(1, Math.ceil((restrictionMs - nowMs) / 1000)) : 0
    };
  }

  function adminStats(now = nowIso()) {
    const activeRows = db.prepare(`
      SELECT r.id, r.author_id, r.closed_at,
        COALESCE(SUM(CASE WHEN v.status = 'ACTIVE' AND (r.author_id IS NULL OR v.user_id <> r.author_id) THEN 1 ELSE 0 END), 0) AS independent_active_confirmations,
        COALESCE(SUM(CASE WHEN v.status = 'GONE' AND (r.author_id IS NULL OR v.user_id <> r.author_id) THEN 1 ELSE 0 END), 0) AS independent_gone_confirmations
      FROM road_reports r
      LEFT JOIN road_report_votes v ON v.report_id = r.id
      WHERE r.closed_at IS NULL AND r.expires_at > ?
      GROUP BY r.id
    `).all(now);
    const trust = { unconfirmed: 0, supported: 0, confirmed: 0 };
    for (const row of activeRows) {
      const state = trustState(row);
      if (state === "CONFIRMED") trust.confirmed += 1;
      else if (state === "SUPPORTED") trust.supported += 1;
      else trust.unconfirmed += 1;
    }

    const guardRows = db.prepare(`
      SELECT user_id, abuse_score, restriction_until, last_abuse_at, updated_at
      FROM road_report_user_guard
      ORDER BY updated_at DESC, user_id ASC
    `).all();
    const flaggedUsers = guardRows.map((row) => {
      const guard = creationGuard(Number(row.user_id), now);
      return {
        userId: Number(row.user_id),
        abuseScore: guard.abuseScore,
        restrictedUntil: guard.restrictedUntil,
        lastAbuseAt: row.last_abuse_at || null
      };
    }).filter((row) => row.abuseScore > 0 || row.restrictedUntil).slice(0, 25);

    return {
      policy: {
        independentConfirmationsRequired: INDEPENDENT_CONFIRMATIONS_REQUIRED,
        fastDisputeMinutes: FAST_DISPUTE_MINUTES,
        scoreDecayDays: ABUSE_SCORE_DECAY_DAYS,
        restrictionScore: RESTRICTION_SCORE,
        restrictionHours: RESTRICTION_HOURS,
        escalatedRestrictionScore: ESCALATED_RESTRICTION_SCORE,
        escalatedRestrictionHours: ESCALATED_RESTRICTION_HOURS
      },
      activeReports: activeRows.length,
      trust,
      flaggedUsers: flaggedUsers.length,
      restrictedUsers: flaggedUsers.filter((row) => row.restrictedUntil).length,
      users: flaggedUsers,
      locationHistoryStored: false,
      publicUserRating: false
    };
  }

  return {
    create(authorId, input) {
      const normalized = normalizeInput(input);
      if (!normalized) return null;
      const now = nowIso();
      prune(now);
      const expiresAt = addMinutesIso(now, REPORT_TYPES[normalized.type].ttlMinutes);
      const result = db.prepare(`
        INSERT INTO road_reports(author_id, type, lane, latitude, longitude, created_at, expires_at, closed_at, peer_supported_at, abuse_counted_at)
        VALUES(?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL)
      `).run(authorId, normalized.type, normalized.lane, normalized.latitude, normalized.longitude, now, expiresAt);
      return publicRow(selectPublicById.get(Number(result.lastInsertRowid)));
    },

    list() {
      const now = nowIso();
      return db.prepare(`${publicSelect}
        WHERE r.closed_at IS NULL AND r.expires_at > ?
        GROUP BY r.id
        ORDER BY r.id DESC
      `).all(now).map(publicRow);
    },

    getInternal(reportId) {
      const now = nowIso();
      const report = activeRow(reportId, now);
      return report ? {
        id: Number(report.id),
        authorId: report.author_id === null ? null : Number(report.author_id),
        latitude: Number(report.latitude),
        longitude: Number(report.longitude)
      } : null;
    },

    confirm(userId, reportId, status) {
      if (!CONFIRMATIONS.has(status)) return { error: "invalid_road_report_confirmation" };
      const now = nowIso();
      prune(now);
      db.exec("BEGIN IMMEDIATE");
      try {
        const report = activeRow(reportId, now);
        if (!report) {
          db.exec("ROLLBACK");
          return { error: "road_report_not_found" };
        }
        db.prepare(`
          INSERT INTO road_report_votes(report_id, user_id, status, updated_at)
          VALUES(?, ?, ?, ?)
          ON CONFLICT(report_id, user_id) DO UPDATE SET
            status = excluded.status,
            updated_at = excluded.updated_at
        `).run(reportId, userId, status, now);

        const summary = voteSummary(reportId, report.author_id);
        const independentActive = Number(summary.independent_active || 0);
        const independentGone = Number(summary.independent_gone || 0);
        let closed = false;
        let abuseRecorded = false;

        if (status === "GONE") {
          const authorClosingOwn = report.author_id !== null && Number(userId) === Number(report.author_id);
          if (authorClosingOwn || independentGone >= INDEPENDENT_CONFIRMATIONS_REQUIRED) {
            if (!authorClosingOwn && report.author_id !== null && !report.peer_supported_at && !report.abuse_counted_at) {
              const ageMs = Date.parse(now) - Date.parse(report.created_at);
              if (Number.isFinite(ageMs) && ageMs >= 0 && ageMs <= FAST_DISPUTE_MINUTES * 60 * 1000) {
                db.prepare("UPDATE road_reports SET abuse_counted_at = ? WHERE id = ? AND abuse_counted_at IS NULL")
                  .run(now, reportId);
                recordAbuse(Number(report.author_id), now);
                abuseRecorded = true;
              }
            }
            db.prepare("UPDATE road_reports SET closed_at = ? WHERE id = ? AND closed_at IS NULL").run(now, reportId);
            closed = true;
          }
        } else {
          if (independentActive >= INDEPENDENT_CONFIRMATIONS_REQUIRED && !report.peer_supported_at) {
            db.prepare("UPDATE road_reports SET peer_supported_at = COALESCE(peer_supported_at, ?) WHERE id = ?")
              .run(now, reportId);
          }
          const expiresAt = addMinutesIso(now, REPORT_TYPES[report.type].ttlMinutes);
          db.prepare("UPDATE road_reports SET expires_at = ? WHERE id = ? AND closed_at IS NULL").run(expiresAt, reportId);
        }

        const publicReport = publicRow(selectPublicById.get(reportId));
        db.exec("COMMIT");
        return { closed, report: publicReport, abuseRecorded };
      } catch (error) {
        try { db.exec("ROLLBACK"); } catch {}
        throw error;
      }
    },

    creationGuard,
    adminStats,

    size() {
      const now = nowIso();
      return Number(db.prepare("SELECT COUNT(*) AS n FROM road_reports WHERE closed_at IS NULL AND expires_at > ?").get(now).n || 0);
    },

    prune
  };
}

module.exports = {
  REPORT_TYPES,
  REPORT_LANES,
  CONFIRMATIONS,
  MAX_REPORT_DISTANCE_KM,
  ROAD_REPORT_RETENTION_DAYS,
  INDEPENDENT_CONFIRMATIONS_REQUIRED,
  FAST_DISPUTE_MINUTES,
  ABUSE_SCORE_DECAY_DAYS,
  RESTRICTION_SCORE,
  ESCALATED_RESTRICTION_SCORE,
  RESTRICTION_HOURS,
  ESCALATED_RESTRICTION_HOURS,
  haversineKm,
  normalizeInput,
  createRoadReportRepository
};
