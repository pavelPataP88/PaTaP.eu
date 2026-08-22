const { DRIVER_RADII_KM, validLocation, createLocationRepository } = require("./location");
const { normalizeDriverProfile, publicDriverProfile, createProfileRepository } = require("./profile");
const { createDriverDirectory } = require("./directory");
const { createPeopleRoutes } = require("../people/routes");
const { createParkingRoutes } = require("../parking/routes");
const { createEventRuntime } = require("../events/factory");
const { createEventRoutes } = require("../events/routes");
const { createAccountRoutes } = require("../account/routes");
const { createStorageRoutes } = require("../storage/routes");
const {
  createRoadReportRepository,
  CONFIRMATIONS,
  MAX_REPORT_DISTANCE_KM,
  haversineKm,
  normalizeInput: normalizeRoadReportInput
} = require("../road-reports/repository");

function createDriverRoutes({
  db,
  json,
  requireSession,
  requireCsrf,
  checkRate,
  audit,
  nowIso,
  addMinutes,
  isUniqueConstraint
}) {
  const profiles = createProfileRepository(db);
  const locations = createLocationRepository(db, { addMinutes });
  const directory = createDriverDirectory(db, { addMinutes, nowIso });
  const roadReports = createRoadReportRepository(db, { nowIso });
  const routeOptions = { db, json, requireSession, requireCsrf, checkRate, audit, nowIso, addMinutes };
  // Parking + People initialize their additive domain schemas, including Chat/Radio
  // structures used by the Event Center projection triggers.
  const handleParkingRoute = createParkingRoutes(routeOptions);
  const handlePeopleRoute = createPeopleRoutes(routeOptions);
  const handleAccountRoute = createAccountRoutes(routeOptions);
  const handleStorageRoute = createStorageRoutes(routeOptions);
  const eventRuntime = createEventRuntime({ db, nowIso });
  const handleEventRoute = createEventRoutes({ ...routeOptions, events: eventRuntime.events, push: eventRuntime.push });
  eventRuntime.dispatcher.start();

  return async function handleDriverRoute(req, res, url, body) {
    if (!url.pathname.startsWith("/api/driver/")) return false;
    if (await handleStorageRoute(req, res, url, body)) return true;
    if (await handleAccountRoute(req, res, url, body)) return true;
    if (await handleEventRoute(req, res, url, body)) return true;
    if (await handleParkingRoute(req, res, url, body)) return true;
    if (await handlePeopleRoute(req, res, url, body)) return true;

    if (req.method === "GET" && url.pathname === "/api/driver/profile") {
      const session = requireSession(req, res);
      if (!session) return true;
      json(res, 200, { profile: publicDriverProfile(profiles.get(session.user.id)) });
      return true;
    }

    if (req.method === "GET" && url.pathname === "/api/driver/drivers") {
      const session = requireSession(req, res);
      if (!session) return true;
      json(res, 200, { drivers: directory.search(session.user.id, url.searchParams.get("query")) });
      return true;
    }
    if (req.method === "GET" && url.pathname === "/api/driver/contacts") {
      const session = requireSession(req, res);
      if (!session) return true;
      const contacts = directory.listRelationships(session.user.id);
      json(res, 200, {
        ...contacts,
        counts: Object.fromEntries(Object.entries(contacts.groups).map(([name, drivers]) => [name, drivers.length]))
      });
      return true;
    }

    if (req.method === "GET" && url.pathname === "/api/driver/road-reports") {
      json(res, 200, { reports: roadReports.list() });
      return true;
    }

    const driverMatch = url.pathname.match(/^\/api\/driver\/drivers\/([^/]+)$/);
    if (req.method === "GET" && driverMatch) {
      const session = requireSession(req, res);
      if (!session) return true;
      const driver = directory.find(session.user.id, decodeURIComponent(driverMatch[1]));
      if (!driver) json(res, 404, { error: "driver_not_found" });
      else json(res, 200, { driver });
      return true;
    }

    if (body === undefined) return false;

    if (req.method === "POST" && url.pathname === "/api/driver/road-reports") {
      const session = requireSession(req, res);
      if (!session || !requireCsrf(req, res, session)) return true;
      if (!profiles.exists(session.user.id)) {
        json(res, 409, { error: "driver_profile_required" });
        return true;
      }
      if (!checkRate(`road-report-create:user:${session.user.id}`, 10, 10)) {
        json(res, 429, { error: "road_report_rate_limited" });
        return true;
      }
      const input = normalizeRoadReportInput(body);
      if (!input) {
        json(res, 400, { error: "invalid_road_report" });
        return true;
      }
      if (!profiles.isGpsEnabled(session.user.id)) {
        json(res, 409, { error: "road_report_location_required" });
        return true;
      }
      const origin = locations.getFresh(session.user.id);
      if (!origin) {
        json(res, 409, { error: "road_report_location_required" });
        return true;
      }
      if (haversineKm(origin.latitude, origin.longitude, input.latitude, input.longitude) > MAX_REPORT_DISTANCE_KM) {
        json(res, 400, { error: "road_report_too_far" });
        return true;
      }
      const report = roadReports.create(session.user.id, input);
      eventRuntime.events.roadReport(session.user.id, report);
      audit(req, "road_report_created", {
        userId: session.user.id,
        success: true,
        details: { reportId: report.id, type: report.type }
      });
      json(res, 201, { report });
      return true;
    }

    const roadReportConfirmMatch = url.pathname.match(/^\/api\/driver\/road-reports\/(\d+)\/confirm$/);
    if (req.method === "POST" && roadReportConfirmMatch) {
      const session = requireSession(req, res);
      if (!session || !requireCsrf(req, res, session)) return true;
      if (!profiles.exists(session.user.id)) {
        json(res, 409, { error: "driver_profile_required" });
        return true;
      }
      if (!checkRate(`road-report-confirm:user:${session.user.id}`, 30, 5)) {
        json(res, 429, { error: "road_report_rate_limited" });
        return true;
      }
      const status = String(body?.status || "").toUpperCase();
      if (!CONFIRMATIONS.has(status)) {
        json(res, 400, { error: "invalid_road_report_confirmation" });
        return true;
      }
      const reportId = Number(roadReportConfirmMatch[1]);
      const target = roadReports.getInternal(reportId);
      if (!target) {
        json(res, 404, { error: "road_report_not_found" });
        return true;
      }
      const isAuthorClosingOwn = status === "GONE" && target.authorId === session.user.id;
      if (!isAuthorClosingOwn) {
        if (!profiles.isGpsEnabled(session.user.id)) {
          json(res, 409, { error: "road_report_location_required" });
          return true;
        }
        const origin = locations.getFresh(session.user.id);
        if (!origin) {
          json(res, 409, { error: "road_report_location_required" });
          return true;
        }
        if (haversineKm(origin.latitude, origin.longitude, target.latitude, target.longitude) > MAX_REPORT_DISTANCE_KM) {
          json(res, 400, { error: "road_report_too_far" });
          return true;
        }
      }
      const result = roadReports.confirm(session.user.id, reportId, status);
      audit(req, result.closed ? "road_report_closed" : "road_report_confirmed", {
        userId: session.user.id,
        success: true,
        details: { reportId, status }
      });
      json(res, 200, result);
      return true;
    }

    const driverActionMatch = url.pathname.match(/^\/api\/driver\/drivers\/([^/]+)\/(contact|block|decline)$/);
    if (driverActionMatch) {
      const session = requireSession(req, res);
      if (!session || !requireCsrf(req, res, session)) return true;
      const nickname = decodeURIComponent(driverActionMatch[1]);
      try {
        let driver;
        if (req.method === "POST" && driverActionMatch[2] === "contact") driver = directory.requestContact(session.user.id, nickname, nowIso());
        else if (req.method === "DELETE" && driverActionMatch[2] === "contact") driver = directory.removeContact(session.user.id, nickname);
        else if (req.method === "POST" && driverActionMatch[2] === "decline") driver = directory.declineContact(session.user.id, nickname);
        else if (req.method === "PUT" && driverActionMatch[2] === "block" && typeof body.enabled === "boolean") driver = directory.setBlocked(session.user.id, nickname, body.enabled, nowIso());
        else return false;
        if (!driver) return json(res, 404, { error: "driver_not_found" });
        audit(req, driverActionMatch[2] === "contact" ? req.method === "DELETE" ? "driver_contact_removed" : "driver_contact_requested" : driverActionMatch[2] === "decline" ? "driver_contact_declined" : body.enabled ? "driver_blocked" : "driver_unblocked", { userId: session.user.id, success: true });
        json(res, 200, { driver });
      } catch (error) {
        json(res, error.status || 400, { error: error.message || "driver_action_invalid" });
      }
      return true;
    }

    if (req.method === "POST" && url.pathname === "/api/driver/nearby") {
      const session = requireSession(req, res);
      if (!session || !requireCsrf(req, res, session)) return true;
      const radius = body.radius;
      if (typeof radius !== "number" || !DRIVER_RADII_KM.has(radius)) {
        json(res, 400, { error: "invalid_radius" });
        return true;
      }
      if (!profiles.exists(session.user.id)) {
        json(res, 409, { error: "driver_profile_required" });
        return true;
      }
      if (!profiles.isGpsEnabled(session.user.id)) {
        json(res, 409, { error: "gps_disabled" });
        return true;
      }
      const origin = locations.getFresh(session.user.id);
      json(res, 200, {
        radiusKm: radius,
        locationReady: Boolean(origin),
        drivers: origin ? locations.nearbyDrivers(session.user.id, origin, radius) : []
      });
      return true;
    }

    if (req.method === "PUT" && url.pathname === "/api/driver/gps") {
      const session = requireSession(req, res);
      if (!session || !requireCsrf(req, res, session)) return true;
      if (!profiles.exists(session.user.id)) {
        json(res, 409, { error: "driver_profile_required" });
        return true;
      }
      if (typeof body.enabled !== "boolean") {
        json(res, 400, { error: "invalid_gps_state" });
        return true;
      }
      const wasEnabled = profiles.isGpsEnabled(session.user.id);
      if (body.enabled) {
        profiles.setGpsEnabled(session.user.id, true, nowIso());
      } else {
        db.exec("BEGIN IMMEDIATE");
        try {
          profiles.setGpsEnabled(session.user.id, false, nowIso());
          locations.remove(session.user.id);
          db.exec("COMMIT");
        } catch (error) {
          db.exec("ROLLBACK");
          throw error;
        }
      }
      if (wasEnabled !== body.enabled) {
        audit(req, body.enabled ? "driver_gps_enabled" : "driver_gps_disabled", {
          userId: session.user.id, success: true
        });
      }
      json(res, 200, { gpsEnabled: body.enabled });
      return true;
    }

    if (req.method === "PUT" && url.pathname === "/api/driver/profile") {
      const session = requireSession(req, res);
      if (!session || !requireCsrf(req, res, session)) return true;
      const profile = normalizeDriverProfile(body);
      if (!profile) {
        json(res, 400, { error: "invalid_driver_profile" });
        return true;
      }
      const existed = profiles.exists(session.user.id);
      let stored;
      try {
        stored = profiles.save(session.user.id, profile, nowIso());
      } catch (error) {
        if (isUniqueConstraint(error)) {
          json(res, 409, { error: "nickname_exists" });
          return true;
        }
        throw error;
      }
      audit(req, existed ? "driver_profile_updated" : "driver_profile_created", {
        userId: session.user.id,
        success: true,
        details: { driverType: profile.driverType }
      });
      json(res, existed ? 200 : 201, { profile: publicDriverProfile(stored) });
      return true;
    }

    if (req.method === "PUT" && url.pathname === "/api/driver/location") {
      const session = requireSession(req, res);
      if (!session || !requireCsrf(req, res, session)) return true;
      if (!profiles.exists(session.user.id)) {
        json(res, 409, { error: "driver_profile_required" });
        return true;
      }
      if (!profiles.isGpsEnabled(session.user.id)) {
        json(res, 409, { error: "gps_disabled" });
        return true;
      }
      const location = validLocation(body);
      if (!location) {
        json(res, 400, { error: "invalid_location" });
        return true;
      }
      if (!checkRate(`driver-location:user:${session.user.id}`, 1, 1 / 12)) {
        json(res, 429, { error: "location_rate_limited" });
        return true;
      }
      const existed = locations.exists(session.user.id);
      const updatedAt = nowIso();
      locations.save(session.user.id, location, updatedAt);
      if (!existed) audit(req, "driver_visibility_enabled", { userId: session.user.id, success: true });
      json(res, 200, { location: { ...location, updatedAt } });
      return true;
    }

    if (req.method === "DELETE" && url.pathname === "/api/driver/location") {
      const session = requireSession(req, res);
      if (!session || !requireCsrf(req, res, session)) return true;
      const changes = locations.remove(session.user.id);
      if (changes > 0) audit(req, "driver_visibility_disabled", { userId: session.user.id, success: true });
      json(res, 200, { ok: true });
      return true;
    }

    return false;
  };
}

module.exports = { createDriverRoutes };
