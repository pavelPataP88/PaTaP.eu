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
    if (!REPORT_LANES.has(lane)) return null;
  } else if (lane !== null) {
    return null;
  }
  return { type, lane, latitude, longitude };
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

function createRoadReportStore({ now = () => Date.now() } = {}) {
  const reports = new Map();
  let nextId = 1;

  function prune() {
    const current = now();
    for (const [id, report] of reports) {
      if (report.closedAt || report.expiresAt <= current) reports.delete(id);
    }
  }

  return {
    create(authorId, input) {
      const normalized = normalizeInput(input);
      if (!normalized) return null;
      prune();
      const current = now();
      const ttlMs = REPORT_TYPES[normalized.type].ttlMinutes * 60 * 1000;
      const report = {
        id: nextId++,
        authorId,
        ...normalized,
        createdAt: current,
        expiresAt: current + ttlMs,
        closedAt: null,
        votes: new Map()
      };
      reports.set(report.id, report);
      return publicReport(report);
    },
    list() {
      prune();
      return [...reports.values()].sort((left, right) => right.id - left.id).map(publicReport);
    },
    getInternal(reportId) {
      prune();
      const report = reports.get(reportId);
      return report ? {
        id: report.id,
        authorId: report.authorId,
        latitude: report.latitude,
        longitude: report.longitude
      } : null;
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
    size() {
      prune();
      return reports.size;
    }
  };
}

module.exports = {
  REPORT_TYPES,
  REPORT_LANES,
  CONFIRMATIONS,
  MAX_REPORT_DISTANCE_KM,
  haversineKm,
  normalizeInput,
  createRoadReportStore
};
