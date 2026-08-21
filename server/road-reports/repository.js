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

function publicRow(row) {
  if (!row) return null;
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
    }
  };
}

function addMinutesIso(iso, minutes) {
  return new Date(Date.parse(iso) + minutes * 60 * 1000).toISOString();
}

function addDaysIso(iso, days) {
  return new Date(Date.parse(iso) + days * 24 * 60 * 60 * 1000).toISOString();
}

function createRoadReportRepository(db, { nowIso = () => new Date().toISOString() } = {}) {
  ensureRoadReportSchema(db, nowIso());

  const selectPublicById = db.prepare(`
    SELECT r.*,
      COALESCE(SUM(CASE WHEN v.status = 'ACTIVE' THEN 1 ELSE 0 END), 0) AS active_confirmations,
      COALESCE(SUM(CASE WHEN v.status = 'GONE' THEN 1 ELSE 0 END), 0) AS gone_confirmations
    FROM road_reports r
    LEFT JOIN road_report_votes v ON v.report_id = r.id
    WHERE r.id = ?
    GROUP BY r.id
  `);

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
      SELECT id, author_id, type, lane, latitude, longitude, created_at, expires_at, closed_at
      FROM road_reports
      WHERE id = ? AND closed_at IS NULL AND expires_at > ?
    `).get(reportId, now) || null;
  }

  return {
    create(authorId, input) {
      const normalized = normalizeInput(input);
      if (!normalized) return null;
      const now = nowIso();
      prune(now);
      const expiresAt = addMinutesIso(now, REPORT_TYPES[normalized.type].ttlMinutes);
      const result = db.prepare(`
        INSERT INTO road_reports(author_id, type, lane, latitude, longitude, created_at, expires_at, closed_at)
        VALUES(?, ?, ?, ?, ?, ?, ?, NULL)
      `).run(authorId, normalized.type, normalized.lane, normalized.latitude, normalized.longitude, now, expiresAt);
      return publicRow(selectPublicById.get(Number(result.lastInsertRowid)));
    },

    list() {
      const now = nowIso();
      prune(now);
      return db.prepare(`
        SELECT r.*,
          COALESCE(SUM(CASE WHEN v.status = 'ACTIVE' THEN 1 ELSE 0 END), 0) AS active_confirmations,
          COALESCE(SUM(CASE WHEN v.status = 'GONE' THEN 1 ELSE 0 END), 0) AS gone_confirmations
        FROM road_reports r
        LEFT JOIN road_report_votes v ON v.report_id = r.id
        WHERE r.closed_at IS NULL AND r.expires_at > ?
        GROUP BY r.id
        ORDER BY r.id DESC
      `).all(now).map(publicRow);
    },

    getInternal(reportId) {
      const now = nowIso();
      prune(now);
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

        let closed = false;
        if (status === "GONE") {
          const gone = Number(db.prepare("SELECT COUNT(*) AS n FROM road_report_votes WHERE report_id = ? AND status = 'GONE'").get(reportId).n || 0);
          if (Number(userId) === Number(report.author_id) || gone >= 2) {
            db.prepare("UPDATE road_reports SET closed_at = ? WHERE id = ? AND closed_at IS NULL").run(now, reportId);
            closed = true;
          }
        } else {
          const expiresAt = addMinutesIso(now, REPORT_TYPES[report.type].ttlMinutes);
          db.prepare("UPDATE road_reports SET expires_at = ? WHERE id = ? AND closed_at IS NULL").run(expiresAt, reportId);
        }

        const publicReport = publicRow(selectPublicById.get(reportId));
        db.exec("COMMIT");
        return { closed, report: publicReport };
      } catch (error) {
        try { db.exec("ROLLBACK"); } catch {}
        throw error;
      }
    },

    size() {
      const now = nowIso();
      prune(now);
      return Number(db.prepare("SELECT COUNT(*) AS n FROM road_reports WHERE closed_at IS NULL AND expires_at > ?").get(now).n || 0);
    },

    prune
  };
}

// Legacy in-memory store kept for isolated pure-logic callers. Production Driver
// routes use createRoadReportRepository() so road state survives backend restart.
function createRoadReportStore({ now = () => Date.now() } = {}) {
  const reports = new Map();
  let nextId = 1;

  function prune() {
    const current = now();
    for (const [id, report] of reports) {
      if (report.closedAt || report.expiresAt <= current) reports.delete(id);
    }
  }

  function publicReport(report) {
    return {
      id: report.id,
      type: report.type,
      lane: report.lane,
      latitude: report.latitude,
      longitude: report.longitude,
      createdAt: new Date(report.createdAt).toISOString(),
      expiresAt: new Date(report.expiresAt).toISOString(),
      confirmations: {
        active: [...report.votes.values()].filter((value) => value === "ACTIVE").length,
        gone: [...report.votes.values()].filter((value) => value === "GONE").length
      }
    };
  }

  return {
    create(authorId, input) {
      const normalized = normalizeInput(input);
      if (!normalized) return null;
      prune();
      const current = now();
      const ttlMs = REPORT_TYPES[normalized.type].ttlMinutes * 60 * 1000;
      const report = { id: nextId++, authorId, ...normalized, createdAt: current, expiresAt: current + ttlMs, closedAt: null, votes: new Map() };
      reports.set(report.id, report);
      return publicReport(report);
    },
    list() { prune(); return [...reports.values()].sort((left, right) => right.id - left.id).map(publicReport); },
    getInternal(reportId) {
      prune();
      const report = reports.get(reportId);
      return report ? { id: report.id, authorId: report.authorId, latitude: report.latitude, longitude: report.longitude } : null;
    },
    confirm(userId, reportId, status) {
      if (!CONFIRMATIONS.has(status)) return { error: "invalid_road_report_confirmation" };
      prune();
      const report = reports.get(reportId);
      if (!report) return { error: "road_report_not_found" };
      report.votes.set(userId, status);
      if (status === "GONE") {
        const gone = [...report.votes.values()].filter((value) => value === "GONE").length;
        if (userId === report.authorId || gone >= 2) {
          report.closedAt = now();
          reports.delete(report.id);
          return { closed: true, report: publicReport(report) };
        }
      } else {
        report.expiresAt = now() + REPORT_TYPES[report.type].ttlMinutes * 60 * 1000;
      }
      return { closed: false, report: publicReport(report) };
    },
    size() { prune(); return reports.size; }
  };
}

module.exports = {
  REPORT_TYPES,
  REPORT_LANES,
  CONFIRMATIONS,
  MAX_REPORT_DISTANCE_KM,
  ROAD_REPORT_RETENTION_DAYS,
  haversineKm,
  normalizeInput,
  createRoadReportRepository,
  createRoadReportStore
};
