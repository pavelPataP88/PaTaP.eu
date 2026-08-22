const http = require("http");
const {
  openDb,
  DATA_DIR,
  nowIso,
  addMinutes,
  normalizeUsername,
  normalizeEmail,
  validateUsername,
  validateEmail,
  validatePassword,
  hashToken,
  randomToken,
  publicUser,
  canAdmin,
  canManageRole,
  assertRole
} = require("./db");
const { hashPassword, verifyPassword } = require("./password");
const { createDriverRoutes } = require("../driver/routes");
const { createChatRoutes } = require("../chat/routes");
const { createChatRepository } = require("../chat/repository");
const { createChatRealtime } = require("../chat/realtime");
const { createRadioRoutes } = require("../radio/routes");
const { normalizeDriverProfile, publicDriverProfile, createProfileRepository } = require("../driver/profile");

const HOST = "127.0.0.1";
const PORT = Number(process.env.PATAP_AUTH_PORT || 8091);
const MAX_BODY = 64 * 1024;
const SESSION_COOKIE = "patap_session";
const CSRF_COOKIE = "patap_csrf";
const SESSION_TOUCH_MINUTES = 1;
const PATAP_COOKIE_DOMAIN = "patap.eu";
const PATAP_PUBLIC_HOSTS = new Set(["patap.eu", "www.patap.eu", "driver.patap.eu"]);
const ALLOWED_CSRF_ORIGINS = new Set([
  "https://patap.eu",
  "https://www.patap.eu",
  "https://driver.patap.eu",
  "http://127.0.0.1:8090"
]);
const db = openDb();
const driverProfiles = createProfileRepository(db);

function json(res, status, body, headers = {}) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...headers
  });
  res.end(JSON.stringify(body));
}

function parseCookies(req) {
  const header = req.headers.cookie || "";
  const cookies = {};
  for (const part of header.split(";")) {
    const [rawKey, ...rawValue] = part.trim().split("=");
    if (!rawKey) continue;
    cookies[rawKey] = decodeURIComponent(rawValue.join("=") || "");
  }
  return cookies;
}

function cookie(name, value, options = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`, "Path=/", "SameSite=Lax"];
  if (options.domain) parts.push(`Domain=${options.domain}`);
  if (options.httpOnly) parts.push("HttpOnly");
  if (options.secure !== false) parts.push("Secure");
  if (options.maxAge !== undefined) parts.push(`Max-Age=${options.maxAge}`);
  return parts.join("; ");
}

function clearCookie(name, options = {}) {
  return cookie(name, "", { ...options, maxAge: 0 });
}

function isTrustedLocalPeer(req) {
  const remote = req.socket.remoteAddress;
  return remote === "127.0.0.1" || remote === "::1" || remote === "::ffff:127.0.0.1";
}

function requestHostname(req) {
  const forwarded = isTrustedLocalPeer(req)
    ? String(req.headers["x-forwarded-host"] || "").split(",")[0].trim()
    : "";
  return String(forwarded || req.headers.host || "").toLowerCase().split(":")[0];
}

function publicCookieDomain(req) {
  return PATAP_PUBLIC_HOSTS.has(requestHostname(req)) ? PATAP_COOKIE_DOMAIN : undefined;
}

function isSecureRequest(req) {
  const proto = String(req.headers["x-forwarded-proto"] || "").toLowerCase();
  return proto === "https" || PATAP_PUBLIC_HOSTS.has(requestHostname(req));
}

function getClientIp(req) {
  const remote = req.socket.remoteAddress;
  if (isTrustedLocalPeer(req)) {
    return req.headers["cf-connecting-ip"] || String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() || remote;
  }
  return remote || "unknown";
}

function audit(req, eventType, { userId = null, targetUserId = null, success = false, details = {} } = {}) {
  db.prepare(`
    INSERT INTO audit_events(created_at, event_type, user_id, target_user_id, success, source_ip, user_agent, details)
    VALUES(?, ?, ?, ?, ?, ?, ?, ?)
  `).run(nowIso(), eventType, userId, targetUserId, success ? 1 : 0, getClientIp(req), req.headers["user-agent"] || "", JSON.stringify(details));
}

function getSession(req) {
  const cookies = parseCookies(req);
  const sid = cookies[SESSION_COOKIE];
  if (!sid) return null;
  const now = nowIso();
  const session = db.prepare(`
    SELECT sessions.*,
           sessions.last_seen_at AS session_last_seen_at,
           users.username, users.email, users.role, users.disabled, users.created_at AS user_created_at,
           users.last_login_at, users.last_seen_at AS user_last_seen_at
    FROM sessions
    JOIN users ON users.id = sessions.user_id
    WHERE sessions.id = ? AND sessions.revoked_at IS NULL AND sessions.expires_at > ?
  `).get(hashToken(sid), now);
  if (!session || session.disabled) return null;

  const touchBefore = addMinutes(-SESSION_TOUCH_MINUTES);
  const sessionNeedsTouch = !session.session_last_seen_at || session.session_last_seen_at <= touchBefore;
  const userNeedsTouch = !session.user_last_seen_at || session.user_last_seen_at <= touchBefore;
  if (sessionNeedsTouch) db.prepare("UPDATE sessions SET last_seen_at = ? WHERE id = ?").run(now, session.id);
  if (userNeedsTouch) db.prepare("UPDATE users SET last_seen_at = ? WHERE id = ?").run(now, session.user_id);

  return {
    rawId: sid,
    csrfToken: session.csrf_token,
    user: {
      id: session.user_id,
      username: session.username,
      email: session.email,
      role: session.role,
      disabled: session.disabled,
      created_at: session.user_created_at,
      last_login_at: session.last_login_at,
      last_seen_at: userNeedsTouch ? now : session.user_last_seen_at
    }
  };
}

function requireSession(req, res) {
  const session = getSession(req);
  if (!session) {
    json(res, 401, { error: "not_authenticated" });
    return null;
  }
  return session;
}

function requireAdmin(req, res) {
  const session = requireSession(req, res);
  if (!session) return null;
  if (!canAdmin(session.user.role)) {
    audit(req, "admin_denied", { userId: session.user.id, success: false });
    json(res, 403, { error: "forbidden" });
    return null;
  }
  return session;
}

function requireCsrf(req, res, session = null) {
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) return true;
  const origin = req.headers.origin;
  if (origin && !ALLOWED_CSRF_ORIGINS.has(origin)) {
    audit(req, "csrf_origin_rejected", { userId: session?.user?.id, success: false });
    json(res, 403, { error: "csrf_failed" });
    return false;
  }
  const cookies = parseCookies(req);
  const headerToken = req.headers["x-csrf-token"];
  const cookieToken = cookies[CSRF_COOKIE];
  const expected = session?.csrfToken || cookieToken;
  if (!headerToken || !cookieToken || headerToken !== cookieToken || (expected && headerToken !== expected)) {
    audit(req, "csrf_rejected", { userId: session?.user?.id, success: false });
    json(res, 403, { error: "csrf_failed" });
    return false;
  }
  return true;
}

function checkRate(key, limit, windowMinutes) {
  const now = nowIso();
  const row = db.prepare("SELECT * FROM rate_limits WHERE key = ?").get(key);
  if (!row || row.reset_at <= now) {
    db.prepare("INSERT OR REPLACE INTO rate_limits(key, count, reset_at) VALUES(?, ?, ?)").run(key, 1, addMinutes(windowMinutes));
    return true;
  }
  if (row.count >= limit) return false;
  db.prepare("UPDATE rate_limits SET count = count + 1 WHERE key = ?").run(key);
  return true;
}

function cleanupSecurityData() {
  const now = nowIso();
  db.prepare("DELETE FROM rate_limits WHERE reset_at <= ?").run(now);
  db.prepare("DELETE FROM password_reset_tokens WHERE expires_at <= ? OR (used_at IS NOT NULL AND used_at <= ?)")
    .run(now, addMinutes(-24 * 60));
  db.prepare("DELETE FROM sessions WHERE expires_at <= ? AND (revoked_at IS NULL OR revoked_at <= ?)")
    .run(addMinutes(-7 * 24 * 60), addMinutes(-7 * 24 * 60));
  db.prepare("DELETE FROM audit_events WHERE created_at < ?").run(addMinutes(-90 * 24 * 60));
}

function isUniqueConstraint(error) {
  return Boolean(error) && (
    error.code === "ERR_SQLITE_CONSTRAINT_UNIQUE" ||
    error.code === "SQLITE_CONSTRAINT_UNIQUE" ||
    /UNIQUE constraint failed/i.test(String(error.message || ""))
  );
}

async function readBody(req) {
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) return {};
  const type = req.headers["content-type"] || "";
  if (!type.includes("application/json")) {
    const error = new Error("unsupported_media_type");
    error.status = 415;
    throw error;
  }
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) {
      const error = new Error("payload_too_large");
      error.status = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    const error = new Error("invalid_json");
    error.status = 400;
    throw error;
  }
}

async function readBinaryBody(req, maxBytes) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) {
      const error = new Error("payload_too_large");
      error.status = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function createSession(req, res, user) {
  const rawSession = randomToken(32);
  const csrfToken = randomToken(24);
  const domain = publicCookieDomain(req);
  db.prepare(`
    INSERT INTO sessions(id, user_id, csrf_token, created_at, expires_at, last_seen_at, ip, user_agent)
    VALUES(?, ?, ?, ?, ?, ?, ?, ?)
  `).run(hashToken(rawSession), user.id, csrfToken, nowIso(), addMinutes(canAdmin(user.role) ? 240 : 720), nowIso(), getClientIp(req), req.headers["user-agent"] || "");
  const secure = isSecureRequest(req);
  const cookies = [];
  if (domain) {
    cookies.push(
      clearCookie(SESSION_COOKIE, { httpOnly: true, secure }),
      clearCookie(CSRF_COOKIE, { httpOnly: false, secure })
    );
  }
  cookies.push(
    cookie(SESSION_COOKIE, rawSession, { domain, httpOnly: true, secure }),
    cookie(CSRF_COOKIE, csrfToken, { domain, httpOnly: false, secure })
  );
  res.setHeader("Set-Cookie", cookies);
  return csrfToken;
}

function refreshSharedSessionCookies(req, res, session) {
  const domain = publicCookieDomain(req);
  if (!domain) return;
  const secure = isSecureRequest(req);
  res.setHeader("Set-Cookie", [
    clearCookie(SESSION_COOKIE, { httpOnly: true, secure }),
    clearCookie(CSRF_COOKIE, { httpOnly: false, secure }),
    cookie(SESSION_COOKIE, session.rawId, { domain, httpOnly: true, secure }),
    cookie(CSRF_COOKIE, session.csrfToken, { domain, httpOnly: false, secure })
  ]);
}

function revokeSession(req) {
  const sid = parseCookies(req)[SESSION_COOKIE];
  if (sid) db.prepare("UPDATE sessions SET revoked_at = ? WHERE id = ?").run(nowIso(), hashToken(sid));
}

function loginResponse(user, csrfToken) {
  return { user: publicUser(user), csrfToken };
}

function adminStats() {
  const totalUsers = db.prepare("SELECT COUNT(*) AS n FROM users").get().n;
  const newUsers = db.prepare("SELECT COUNT(*) AS n FROM users WHERE created_at >= ?").get(addMinutes(-24 * 60)).n;
  const returningUsers = db.prepare("SELECT COUNT(*) AS n FROM users WHERE last_login_at IS NOT NULL").get().n;
  const recentlyActive = db.prepare("SELECT COUNT(*) AS n FROM users WHERE last_seen_at >= ?").get(addMinutes(-60)).n;
  const disabledLocked = db.prepare("SELECT COUNT(*) AS n FROM users WHERE disabled = 1 OR (locked_until IS NOT NULL AND locked_until > ?)").get(nowIso()).n;
  const successfulLogins = db.prepare("SELECT COUNT(*) AS n FROM audit_events WHERE event_type = 'login' AND success = 1").get().n;
  const failedLogins = db.prepare("SELECT COUNT(*) AS n FROM audit_events WHERE event_type = 'login' AND success = 0").get().n;
  const suspiciousAdmin = db.prepare(`
    SELECT COUNT(*) AS n
    FROM audit_events
    WHERE success = 0 AND event_type IN ('login','admin_denied','csrf_rejected','rate_limited')
  `).get().n;
  const activeSessions = db.prepare("SELECT COUNT(*) AS n FROM sessions WHERE revoked_at IS NULL AND expires_at > ?").get(nowIso()).n;
  return { totalUsers, newUsers, returningUsers, recentlyActive, disabledLocked, successfulLogins, failedLogins, suspiciousAdmin, activeSessions };
}

function usersList() {
  return db.prepare(`
    SELECT id, username, email, role, disabled, locked_until, created_at, last_login_at, last_seen_at
    FROM users ORDER BY created_at DESC
  `).all();
}

function ownerCount() {
  return db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'Owner' AND disabled = 0").get().n;
}

function isPrincipalOwner(userId) {
  return Boolean(db.prepare("SELECT 1 FROM principal_owner WHERE singleton = 1 AND user_id = ?").get(userId));
}

const handleDriverRoute = createDriverRoutes({
  db,
  json,
  requireSession,
  requireCsrf,
  checkRate,
  audit,
  nowIso,
  addMinutes,
  isUniqueConstraint
});
let publishChatEvent = () => {};
const chatRepository = createChatRepository(db);
const handleChatRoute = createChatRoutes({
  db, json, requireSession, requireCsrf, checkRate, audit, nowIso,
  publish(event) { publishChatEvent(event); }
});
const handleRadioRoute = createRadioRoutes({
  db, json, requireSession, requireCsrf, checkRate, audit, nowIso, hashToken, randomToken,
  dataDir: DATA_DIR, readBinaryBody
});

async function route(req, res) {
  const url = new URL(req.url, "http://127.0.0.1");

  if (req.method === "GET" && url.pathname === "/api/health") {
    db.prepare("SELECT 1").get();
    return json(res, 200, { ok: true, database: "ok" });
  }

  if (req.method === "GET" && url.pathname === "/api/csrf") {
    const token = randomToken(24);
    const domain = publicCookieDomain(req);
    const secure = isSecureRequest(req);
    const cookies = [];
    if (domain) cookies.push(clearCookie(CSRF_COOKIE, { httpOnly: false, secure }));
    cookies.push(cookie(CSRF_COOKIE, token, { domain, httpOnly: false, secure }));
    res.setHeader("Set-Cookie", cookies);
    return json(res, 200, { csrfToken: token });
  }

  if (req.method === "GET" && url.pathname === "/api/session") {
    const session = getSession(req);
    if (!session) return json(res, 200, { user: null });
    refreshSharedSessionCookies(req, res, session);
    return json(res, 200, loginResponse(session.user, session.csrfToken));
  }

  if (await handleDriverRoute(req, res, url)) return;
  if (await handleChatRoute(req, res, url)) return;
  if (await handleRadioRoute(req, res, url)) return;

  const body = await readBody(req);
  if (await handleDriverRoute(req, res, url, body)) return;
  if (await handleChatRoute(req, res, url, body)) return;
  if (await handleRadioRoute(req, res, url, body)) return;

  if (req.method === "POST" && url.pathname === "/api/driver/register") {
    if (!requireCsrf(req, res)) return;
    const ip = getClientIp(req);
    if (!checkRate(`register:ip:${ip}`, 5, 60)) {
      audit(req, "rate_limited", { success: false, details: { endpoint: "driver_register" } });
      return json(res, 429, { error: "too_many_requests" });
    }
    const username = normalizeUsername(body.username);
    const email = normalizeEmail(body.email);
    const password = String(body.password || "");
    const profile = normalizeDriverProfile(body);
    if (!validateUsername(username) || !validateEmail(email) || !validatePassword(password) || password !== body.confirmPassword || !profile) {
      audit(req, "driver_register", { success: false });
      return json(res, 400, { error: "invalid_driver_registration" });
    }
    let inTransaction = false;
    try {
      const passwordHash = await hashPassword(password);
      const now = nowIso();
      db.exec("BEGIN IMMEDIATE");
      inTransaction = true;
      const result = db.prepare(`
        INSERT INTO users(username, email, password_hash, role, created_at, updated_at)
        VALUES(?, ?, ?, 'User', ?, ?)
      `).run(username, email, passwordHash, now, now);
      const user = db.prepare("SELECT * FROM users WHERE id = ?").get(result.lastInsertRowid);
      const storedProfile = driverProfiles.save(user.id, profile, now);
      db.exec("COMMIT");
      inTransaction = false;
      const csrfToken = createSession(req, res, user);
      audit(req, "driver_register", { userId: user.id, success: true, details: { driverType: profile.driverType } });
      return json(res, 201, { ...loginResponse(user, csrfToken), profile: publicDriverProfile(storedProfile), emailVerificationEnabled: false });
    } catch (error) {
      if (inTransaction) db.exec("ROLLBACK");
      audit(req, "driver_register", { success: false });
      if (isUniqueConstraint(error)) return json(res, 409, { error: "username_email_or_nickname_exists" });
      console.error("Driver registration failed:", error);
      return json(res, 500, { error: "server_error" });
    }
  }

  if (req.method === "POST" && url.pathname === "/api/register") {
    if (!requireCsrf(req, res)) return;
    const ip = getClientIp(req);
    if (!checkRate(`register:ip:${ip}`, 5, 60)) {
      audit(req, "rate_limited", { success: false, details: { endpoint: "register" } });
      return json(res, 429, { error: "too_many_requests" });
    }
    const username = normalizeUsername(body.username);
    const email = normalizeEmail(body.email);
    const password = String(body.password || "");
    if (!validateUsername(username) || !validateEmail(email) || !validatePassword(password) || password !== body.confirmPassword) {
      audit(req, "register", { success: false });
      return json(res, 400, { error: "invalid_registration" });
    }
    try {
      const passwordHash = await hashPassword(password);
      const now = nowIso();
      const result = db.prepare(`
        INSERT INTO users(username, email, password_hash, role, created_at, updated_at)
        VALUES(?, ?, ?, 'User', ?, ?)
      `).run(username, email, passwordHash, now, now);
      const user = db.prepare("SELECT * FROM users WHERE id = ?").get(result.lastInsertRowid);
      const csrfToken = createSession(req, res, user);
      audit(req, "register", { userId: user.id, success: true });
      return json(res, 201, { ...loginResponse(user, csrfToken), emailVerificationEnabled: false });
    } catch (error) {
      audit(req, "register", { success: false });
      if (isUniqueConstraint(error)) {
        return json(res, 409, { error: "username_or_email_exists" });
      }
      console.error("Registration failed:", error);
      return json(res, 500, { error: "server_error" });
    }
  }

  if (req.method === "POST" && url.pathname === "/api/login") {
    if (!requireCsrf(req, res)) return;
    const identifier = normalizeEmail(body.identifier || body.email || body.username);
    const ip = getClientIp(req);
    if (!checkRate(`login:ip:${ip}`, 20, 15) || !checkRate(`login:id:${identifier}`, 5, 15)) {
      audit(req, "rate_limited", { success: false, details: { endpoint: "login" } });
      return json(res, 429, { error: "too_many_requests" });
    }
    const initialUser = db.prepare("SELECT * FROM users WHERE username = ? OR email = ?").get(identifier, identifier);
    const initialNow = nowIso();
    const canVerify = Boolean(initialUser && !initialUser.disabled && !(initialUser.locked_until && initialUser.locked_until > initialNow));
    const passwordMatches = canVerify ? await verifyPassword(String(body.password || ""), initialUser.password_hash) : false;
    const user = initialUser ? db.prepare("SELECT * FROM users WHERE id = ?").get(initialUser.id) : null;
    const currentNow = nowIso();
    const passwordChanged = Boolean(initialUser && user && user.password_hash !== initialUser.password_hash);
    const unavailable = !user || user.disabled || (user.locked_until && user.locked_until > currentNow) || passwordChanged;
    if (unavailable || !passwordMatches) {
      if (user && !passwordChanged) {
        db.prepare(`
          UPDATE users
          SET failed_login_count = failed_login_count + 1,
              locked_until = CASE WHEN failed_login_count + 1 >= 5 THEN ? ELSE locked_until END,
              updated_at = ?
          WHERE id = ?
        `).run(addMinutes(15), currentNow, user.id);
      }
      audit(req, "login", { userId: user?.id || initialUser?.id, success: false });
      return json(res, 401, { error: "invalid_credentials" });
    }
    db.prepare("UPDATE users SET failed_login_count = 0, locked_until = NULL, last_login_at = ?, last_seen_at = ?, updated_at = ? WHERE id = ?")
      .run(currentNow, currentNow, currentNow, user.id);
    const csrfToken = createSession(req, res, user);
    audit(req, "login", { userId: user.id, success: true });
    return json(res, 200, loginResponse(user, csrfToken));
  }

  if (req.method === "POST" && url.pathname === "/api/logout") {
    const session = getSession(req);
    if (!requireCsrf(req, res, session)) return;
    revokeSession(req);
    if (session) audit(req, "logout", { userId: session.user.id, success: true });
    const domain = publicCookieDomain(req);
    const secure = isSecureRequest(req);
    const cookies = [
      clearCookie(SESSION_COOKIE, { httpOnly: true, secure }),
      clearCookie(CSRF_COOKIE, { httpOnly: false, secure })
    ];
    if (domain) {
      cookies.push(
        clearCookie(SESSION_COOKIE, { domain, httpOnly: true, secure }),
        clearCookie(CSRF_COOKIE, { domain, httpOnly: false, secure })
      );
    }
    res.setHeader("Set-Cookie", cookies);
    return json(res, 200, { ok: true });
  }

  if (req.method === "POST" && url.pathname === "/api/password-reset/request") {
    if (!requireCsrf(req, res)) return;
    const ip = getClientIp(req);
    if (!checkRate(`password-reset-request:ip:${ip}`, 5, 60)) {
      audit(req, "rate_limited", { success: false, details: { endpoint: "password-reset-request" } });
      return json(res, 429, { error: "too_many_requests" });
    }
    audit(req, "password_reset_requested", { success: true, details: { admin_assisted: true } });
    return json(res, 200, { ok: true, message: "Password reset requires Owner/Admin assistance." });
  }

  if (req.method === "POST" && url.pathname === "/api/password-reset/complete") {
    if (!requireCsrf(req, res)) return;
    const ip = getClientIp(req);
    if (!checkRate(`password-reset-complete:ip:${ip}`, 10, 15)) {
      audit(req, "rate_limited", { success: false, details: { endpoint: "password-reset-complete" } });
      return json(res, 429, { error: "too_many_requests" });
    }
    const token = String(body.token || "").trim();
    const password = String(body.password || "");
    if (!token || !validatePassword(password) || password !== body.confirmPassword) {
      audit(req, "password_reset_completed", { success: false });
      return json(res, 400, { error: "invalid_reset" });
    }
    const tokenHash = hashToken(token);
    const row = db.prepare("SELECT * FROM password_reset_tokens WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?")
      .get(tokenHash, nowIso());
    if (!row) {
      audit(req, "password_reset_completed", { success: false });
      return json(res, 400, { error: "invalid_reset" });
    }
    const passwordHash = await hashPassword(password);
    let resetTransaction = false;
    try {
      db.exec("BEGIN IMMEDIATE");
      resetTransaction = true;
      const currentRow = db.prepare("SELECT * FROM password_reset_tokens WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?")
        .get(tokenHash, nowIso());
      if (!currentRow) {
        db.exec("ROLLBACK");
        resetTransaction = false;
        audit(req, "password_reset_completed", { userId: row.user_id, success: false });
        return json(res, 400, { error: "invalid_reset" });
      }
      const changedAt = nowIso();
      db.prepare("UPDATE users SET password_hash = ?, failed_login_count = 0, locked_until = NULL, updated_at = ? WHERE id = ?")
        .run(passwordHash, changedAt, currentRow.user_id);
      db.prepare("UPDATE password_reset_tokens SET used_at = ? WHERE id = ?").run(changedAt, currentRow.id);
      db.prepare("UPDATE sessions SET revoked_at = ? WHERE user_id = ?").run(changedAt, currentRow.user_id);
      db.exec("COMMIT");
      resetTransaction = false;
    } catch (error) {
      if (resetTransaction) {
        try { db.exec("ROLLBACK"); } catch {}
      }
      throw error;
    }
    audit(req, "password_reset_completed", { userId: row.user_id, success: true });
    return json(res, 200, { ok: true });
  }

  if (url.pathname === "/api/admin/stats" && req.method === "GET") {
    const session = requireAdmin(req, res);
    if (!session) return;
    return json(res, 200, { stats: adminStats() });
  }

  if (url.pathname === "/api/admin/users" && req.method === "GET") {
    const session = requireAdmin(req, res);
    if (!session) return;
    return json(res, 200, { users: usersList() });
  }

  if (url.pathname === "/api/admin/audit" && req.method === "GET") {
    const session = requireAdmin(req, res);
    if (!session) return;
    const events = db.prepare("SELECT * FROM audit_events ORDER BY id DESC LIMIT 100").all();
    return json(res, 200, { events });
  }

  const userAction = url.pathname.match(/^\/api\/admin\/users\/(\d+)\/(disable|enable|sessions|role|reset-token)$/);
  if (userAction && ["POST", "DELETE"].includes(req.method)) {
    const session = requireAdmin(req, res);
    if (!session || !requireCsrf(req, res, session)) return;
    const targetId = Number(userAction[1]);
    const action = userAction[2];
    const target = db.prepare("SELECT * FROM users WHERE id = ?").get(targetId);
    if (!target) return json(res, 404, { error: "not_found" });
    if (isPrincipalOwner(targetId)) {
      audit(req, "principal_owner_action_denied", {
        userId: session.user.id,
        targetUserId: targetId,
        success: false,
        details: { action }
      });
      return json(res, 403, { error: "principal_owner_protected" });
    }
    if (target.role === "Owner" && session.user.role !== "Owner") {
      audit(req, "owner_action_denied", {
        userId: session.user.id,
        targetUserId: targetId,
        success: false,
        details: { action }
      });
      return json(res, 403, { error: "owner_required" });
    }

    if (action === "disable" && req.method === "POST") {
      if (target.role === "Owner" && ownerCount() <= 1) return json(res, 409, { error: "last_owner_protected" });
      db.prepare("UPDATE users SET disabled = 1, updated_at = ? WHERE id = ?").run(nowIso(), targetId);
      db.prepare("UPDATE sessions SET revoked_at = ? WHERE user_id = ?").run(nowIso(), targetId);
      audit(req, "user_disabled", { userId: session.user.id, targetUserId: targetId, success: true });
      return json(res, 200, { ok: true });
    }
    if (action === "enable" && req.method === "POST") {
      db.prepare("UPDATE users SET disabled = 0, updated_at = ? WHERE id = ?").run(nowIso(), targetId);
      audit(req, "user_enabled", { userId: session.user.id, targetUserId: targetId, success: true });
      return json(res, 200, { ok: true });
    }
    if (action === "sessions" && req.method === "DELETE") {
      db.prepare("UPDATE sessions SET revoked_at = ? WHERE user_id = ?").run(nowIso(), targetId);
      audit(req, "sessions_revoked", { userId: session.user.id, targetUserId: targetId, success: true });
      return json(res, 200, { ok: true });
    }
    if (action === "role" && req.method === "POST") {
      const role = String(body.role || "");
      try { assertRole(role); } catch { return json(res, 400, { error: "invalid_role" }); }
      if (!canManageRole(session.user.role, role)) return json(res, 403, { error: "owner_required" });
      if (role === "Owner") {
        audit(req, "principal_owner_promotion_denied", {
          userId: session.user.id,
          targetUserId: targetId,
          success: false
        });
        return json(res, 409, { error: "principal_owner_exists" });
      }
      if (target.role === "Owner" && role !== "Owner" && ownerCount() <= 1) return json(res, 409, { error: "last_owner_protected" });
      db.prepare("UPDATE users SET role = ?, updated_at = ? WHERE id = ?").run(role, nowIso(), targetId);
      audit(req, "role_changed", { userId: session.user.id, targetUserId: targetId, success: true, details: { role } });
      return json(res, 200, { ok: true });
    }
    if (action === "reset-token" && req.method === "POST") {
      const token = randomToken(32);
      db.prepare("INSERT INTO password_reset_tokens(user_id, token_hash, created_at, expires_at) VALUES(?, ?, ?, ?)")
        .run(targetId, hashToken(token), nowIso(), addMinutes(30));
      audit(req, "password_reset_token_created", { userId: session.user.id, targetUserId: targetId, success: true });
      return json(res, 200, { token, expiresInMinutes: 30 });
    }
  }

  return json(res, 404, { error: "not_found" });
}

const server = http.createServer(async (req, res) => {
  try {
    await route(req, res);
  } catch (error) {
    if (error.status) return json(res, error.status, { error: error.message });
    console.error(error);
    json(res, 500, { error: "server_error" });
  }
});

const chatRealtime = createChatRealtime({
  server,
  repository: chatRepository,
  getSession,
  allowedOrigins: ALLOWED_CSRF_ORIGINS
});
publishChatEvent = chatRealtime.publish;
chatRealtime.start();

let cleanupTimer = null;
server.on("close", () => {
  handleDriverRoute.stop?.();
  chatRealtime.stop();
  if (cleanupTimer) {
    clearInterval(cleanupTimer);
    cleanupTimer = null;
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Patap auth backend listening on http://${HOST}:${PORT}`);
});

cleanupSecurityData();
cleanupTimer = setInterval(cleanupSecurityData, 60 * 60 * 1000);
cleanupTimer.unref();

if (process.env.PATAP_TEST_PARENT_PID) {
  const parentPid = Number(process.env.PATAP_TEST_PARENT_PID);
  const parentWatch = setInterval(() => {
    try {
      process.kill(parentPid, 0);
    } catch {
      clearInterval(parentWatch);
      server.close(() => process.exit(0));
      setTimeout(() => process.exit(1), 2000).unref();
    }
  }, 1000);
  parentWatch.unref();
}
