const { createRoadReportRepository } = require("./repository");

const ADMIN_ROLES = new Set(["Owner", "Administrator"]);

function createRoadReportGuardRoutes(options) {
  const reports = options.roadReports || createRoadReportRepository(options.db, { nowIso: options.nowIso });

  return async function handleRoadReportGuardRoute(req, res, url) {
    if (url.pathname === "/api/driver/admin/road-reports") {
      const session = options.requireSession(req, res);
      if (!session) return true;
      if (!ADMIN_ROLES.has(session.user.role)) {
        options.audit(req, "road_report_admin_denied", { userId: session.user.id, success: false });
        options.json(res, 403, { error: "forbidden" });
        return true;
      }
      if (req.method !== "GET") {
        options.json(res, 405, { error: "method_not_allowed" }, { Allow: "GET" });
        return true;
      }
      options.json(res, 200, { roadReports: reports.adminStats() });
      return true;
    }

    if (req.method !== "POST" || url.pathname !== "/api/driver/road-reports") return false;
    const session = options.requireSession(req, res);
    if (!session) return true;
    const guard = reports.creationGuard(session.user.id);
    if (guard.allowed) return false;

    options.audit(req, "road_report_creation_restricted", {
      userId: session.user.id,
      success: false,
      details: { restrictedUntil: guard.restrictedUntil }
    });
    options.json(res, 429, {
      error: "road_report_temporarily_restricted",
      retryAfterSeconds: guard.retryAfterSeconds
    }, { "Retry-After": String(guard.retryAfterSeconds) });
    return true;
  };
}

module.exports = { createRoadReportGuardRoutes, ADMIN_ROLES };
