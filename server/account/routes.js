const { DATA_DIR, verifyPassword } = require("../auth/db");
const { ensureAccountSchema } = require("./schema");
const { exportAccountData, deleteAccountData } = require("./lifecycle");

const SESSION_COOKIE = "patap_session";
const CSRF_COOKIE = "patap_csrf";
const PUBLIC_HOSTS = new Set(["patap.eu", "www.patap.eu", "driver.patap.eu"]);

function requestHost(req) {
  return String(req.headers["x-forwarded-host"] || req.headers.host || "").split(",")[0].trim().toLowerCase().split(":")[0];
}

function expireCookie(name, { domain = null, httpOnly = false, secure = false } = {}) {
  const parts = [`${name}=`, "Path=/", "SameSite=Lax", "Max-Age=0"];
  if (domain) parts.push(`Domain=${domain}`);
  if (httpOnly) parts.push("HttpOnly");
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

function clearAuthCookies(req, res) {
  const host = requestHost(req);
  const secure = String(req.headers["x-forwarded-proto"] || "").toLowerCase() === "https" || PUBLIC_HOSTS.has(host);
  const cookies = [
    expireCookie(SESSION_COOKIE, { httpOnly: true, secure }),
    expireCookie(CSRF_COOKIE, { secure })
  ];
  if (PUBLIC_HOSTS.has(host)) {
    cookies.push(
      expireCookie(SESSION_COOKIE, { domain: "patap.eu", httpOnly: true, secure }),
      expireCookie(CSRF_COOKIE, { domain: "patap.eu", secure })
    );
  }
  res.setHeader("Set-Cookie", cookies);
}

function createAccountRoutes(options) {
  ensureAccountSchema(options.db, options.nowIso());

  return async function handleAccountRoute(req, res, url, body) {
    if (!url.pathname.startsWith("/api/driver/account")) return false;

    if (req.method === "GET" && url.pathname === "/api/driver/account/export") {
      const session = options.requireSession(req, res);
      if (!session) return true;
      if (!options.checkRate(`account-export:user:${session.user.id}`, 5, 60)) {
        options.json(res, 429, { error: "account_export_rate_limited" });
        return true;
      }
      const exported = exportAccountData(options.db, session.user.id, { nowIso: options.nowIso });
      if (!exported) {
        options.json(res, 404, { error: "account_not_found" });
        return true;
      }
      options.audit(req, "account_exported", { userId: session.user.id, success: true });
      options.json(res, 200, { export: exported });
      return true;
    }

    if (body === undefined) return false;

    if (req.method === "DELETE" && url.pathname === "/api/driver/account") {
      const session = options.requireSession(req, res);
      if (!session || !options.requireCsrf(req, res, session)) return true;
      if (!options.checkRate(`account-delete:user:${session.user.id}`, 5, 60)) {
        options.json(res, 429, { error: "account_delete_rate_limited" });
        return true;
      }
      if (String(body?.confirmation || "") !== "DELETE") {
        options.json(res, 400, { error: "account_delete_confirmation_required" });
        return true;
      }
      const user = options.db.prepare("SELECT password_hash FROM users WHERE id=?").get(session.user.id);
      if (!user || !verifyPassword(String(body?.password || ""), user.password_hash)) {
        options.audit(req, "account_delete_denied", { userId: session.user.id, success: false, details: { reason: "password" } });
        options.json(res, 403, { error: "invalid_credentials" });
        return true;
      }

      options.audit(req, "account_delete_requested", { userId: session.user.id, success: true });
      let result;
      try {
        result = deleteAccountData(options.db, session.user.id, { nowIso: options.nowIso, dataDir: DATA_DIR });
      } catch (error) {
        console.error("Account deletion failed:", error);
        options.json(res, 500, { error: "account_delete_failed" });
        return true;
      }
      if (result.error) {
        options.json(res, result.status || 400, result);
        return true;
      }
      clearAuthCookies(req, res);
      options.json(res, 200, {
        deleted: true,
        deletedAt: result.deletedAt,
        mediaCleanup: result.mediaCleanup
      });
      return true;
    }

    return false;
  };
}

module.exports = { createAccountRoutes, clearAuthCookies };
