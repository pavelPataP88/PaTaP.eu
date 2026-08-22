const { DATA_DIR } = require("../auth/db");
const { createMediaQuota } = require("./quota");

function createStorageRoutes(options) {
  const quota = options.mediaQuota || createMediaQuota({ db: options.db, dataDir: options.dataDir || DATA_DIR });

  return async function handleStorageRoute(req, res, url) {
    if (url.pathname !== "/api/driver/admin/storage") return false;
    const session = options.requireSession(req, res);
    if (!session) return true;
    if (!new Set(["Owner", "Administrator"]).has(session.user.role)) {
      options.audit(req, "storage_admin_denied", { userId: session.user.id, success: false });
      options.json(res, 403, { error: "forbidden" });
      return true;
    }
    if (req.method !== "GET") {
      options.json(res, 405, { error: "method_not_allowed" }, { Allow: "GET" });
      return true;
    }
    options.json(res, 200, { storage: quota.adminStats() });
    return true;
  };
}

module.exports = { createStorageRoutes };
