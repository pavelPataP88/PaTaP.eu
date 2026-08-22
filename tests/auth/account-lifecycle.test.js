const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const runId = process.env.PATAP_TEST_RUN_ID;
const baseUrl = process.env.PATAP_AUTH_BASE_URL;
if (!runId || !baseUrl || !process.env.PATAP_DB_PATH) {
  throw new Error("Account lifecycle tests must run through scripts/run-auth-tests.js");
}

const { openDb, nowIso, DATA_DIR } = require("../../server/auth/db");
const { createChatRepository } = require("../../server/chat/repository");
const { deleteAccountData } = require("../../server/account/lifecycle");

let clientSequence = 120;
class Client {
  constructor() {
    this.cookies = {};
    this.csrfToken = null;
    this.clientIp = `198.51.100.${clientSequence++}`;
  }

  cookieHeader() {
    return Object.entries(this.cookies).map(([key, value]) => `${key}=${value}`).join("; ");
  }

  storeCookies(headers) {
    const values = headers.getSetCookie ? headers.getSetCookie() : [];
    for (const value of values) {
      const [pair] = value.split(";");
      const index = pair.indexOf("=");
      const key = pair.slice(0, index);
      const raw = pair.slice(index + 1);
      if (!raw) delete this.cookies[key];
      else this.cookies[key] = raw;
    }
  }

  async request(pathname, { method = "GET", body, headers = {} } = {}) {
    const requestHeaders = {
      Accept: "application/json",
      Origin: "http://127.0.0.1:8090",
      "CF-Connecting-IP": this.clientIp,
      ...headers
    };
    if (body !== undefined) requestHeaders["Content-Type"] = "application/json";
    if (this.csrfToken) requestHeaders["X-CSRF-Token"] = this.csrfToken;
    const cookie = this.cookieHeader();
    if (cookie) requestHeaders.Cookie = cookie;
    const response = await fetch(`${baseUrl}${pathname}`, {
      method,
      headers: requestHeaders,
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    this.storeCookies(response.headers);
    const data = await response.json().catch(() => ({}));
    if (data.csrfToken) this.csrfToken = data.csrfToken;
    return { response, data };
  }

  csrf() { return this.request("/api/csrf"); }
}

async function registerDriver(prefix, password = "DeletePass1!") {
  const client = new Client();
  await client.csrf();
  const username = `${prefix}_${runId}`.slice(0, 31);
  const email = `${username}@patap.test`;
  const nickname = `${prefix}Driver_${runId}`.slice(0, 31);
  const result = await client.request("/api/driver/register", {
    method: "POST",
    body: {
      username,
      email,
      password,
      confirmPassword: password,
      nickname,
      driverType: "TAXI"
    }
  });
  assert.equal(result.response.status, 201, JSON.stringify(result.data));
  return { client, user: result.data.user, profile: result.data.profile, username, email, nickname, password };
}

function writePrivate(kind, storageKey, content) {
  const directory = path.join(DATA_DIR, kind);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const file = path.join(directory, storageKey);
  fs.writeFileSync(file, content, { mode: 0o600 });
  return file;
}

test("account export excludes secrets and deletion anonymizes shared history while removing private state and media", async () => {
  const target = await registerDriver("delete");
  const peer = await registerDriver("peer");
  const db = openDb();
  const now = nowIso();
  const userId = Number(target.user.id);
  const peerId = Number(peer.user.id);

  const generalRoom = db.prepare("SELECT id FROM chat_rooms WHERE room_key='general'").get();
  assert.ok(generalRoom?.id);
  const message = db.prepare(`INSERT INTO chat_messages(room_id,sender_id,client_message_id,body,created_at)
    VALUES(?,?,?,?,?)`).run(generalRoom.id, userId, `account-delete-${runId}`, "Sensitive shared message", now);
  const messageId = Number(message.lastInsertRowid);

  const chatStorage = `account-${runId}.bin`;
  const chatFile = writePrivate("chat", chatStorage, Buffer.from("chat-private-binary"));
  db.prepare(`INSERT INTO chat_uploads(id,room_id,user_id,upload_token_hash,kind,file_name,mime_type,byte_length,storage_key,duration_ms,state,created_at,expires_at)
    VALUES(?,?,?,?,?,?,?,?,?,?, 'ATTACHED', ?, ?)`)
    .run(`upload-${runId}`, generalRoom.id, userId, "upload-secret-hash", "FILE", "private.txt", "text/plain", 19, chatStorage, null, now, new Date(Date.now() + 3600000).toISOString());
  db.prepare(`INSERT INTO chat_message_attachments(message_id,kind,file_name,mime_type,byte_length,storage_key,duration_ms,created_at)
    VALUES(?,?,?,?,?,?,?,?)`).run(messageId, "FILE", "private.txt", "text/plain", 19, chatStorage, null, now);

  const generalRadio = db.prepare("SELECT id FROM radio_channels WHERE channel_key='radio:general' ORDER BY id LIMIT 1").get()
    || db.prepare("SELECT id FROM radio_channels ORDER BY id LIMIT 1").get();
  assert.ok(generalRadio?.id);
  const radioStorage = `account-${runId}.webm`;
  const radioFile = writePrivate("radio", radioStorage, Buffer.from("radio-private-binary"));
  db.prepare(`INSERT INTO radio_transmissions(channel_id,sender_id,upload_token_hash,mime_type,byte_length,storage_key,state,created_at,expires_at,committed_at)
    VALUES(?,?,?,?,?,?,'COMMITTED',?,?,?)`)
    .run(generalRadio.id, userId, "radio-secret-hash", "audio/webm", 20, radioStorage, now, new Date(Date.now() + 3600000).toISOString(), now);

  const place = db.prepare(`INSERT INTO parking_places(canonical_key,name,latitude,longitude,created_by,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?)`).run(`account:${runId}`, "Account Test Parking", 50.25, 19.02, userId, now, now);
  const placeId = Number(place.lastInsertRowid);
  const parkingStorage = `account-${runId}.png`;
  const parkingFile = writePrivate("parking", parkingStorage, Buffer.from("parking-private-binary"));
  db.prepare(`INSERT INTO parking_photos(place_id,uploader_id,storage_key,mime_type,byte_length,file_name,state,created_at)
    VALUES(?,?,?,?,?,?,'VISIBLE',?)`).run(placeId, userId, parkingStorage, "image/png", 22, "private.png", now);

  db.prepare("UPDATE driver_profiles SET gps_enabled=1,real_name='Real Delete Name',vehicle='Secret Vehicle',country_code='PL' WHERE user_id=?").run(userId);
  db.prepare(`INSERT OR REPLACE INTO driver_locations(user_id,latitude,longitude,accuracy_m,updated_at) VALUES(?,?,?,?,?)`)
    .run(userId, 50.25, 19.02, 7, now);
  db.prepare(`INSERT OR REPLACE INTO driver_people_settings(user_id,discoverability,nearby_visibility,contact_requests,community_invites,vehicle_visibility,updated_at)
    VALUES(?,'EVERYONE','EVERYONE','EVERYONE','CONTACTS','EVERYONE',?)`).run(userId, now);
  db.prepare(`INSERT OR REPLACE INTO driver_relationships(requester_id,target_id,status,created_at,updated_at)
    VALUES(?,?,'ACCEPTED',?,?)`).run(userId, peerId, now, now);

  const road = db.prepare(`INSERT INTO road_reports(author_id,type,lane,latitude,longitude,created_at,expires_at,closed_at)
    VALUES(?,'OBSTACLE',NULL,?,?,?,?,NULL)`).run(userId, 50.25, 19.02, now, new Date(Date.now() + 3600000).toISOString());
  const roadId = Number(road.lastInsertRowid);

  db.prepare("INSERT OR REPLACE INTO driver_event_preferences(user_id,updated_at) VALUES(?,?)").run(userId, now);
  db.prepare(`INSERT OR REPLACE INTO driver_event_category_preferences(user_id,category,updated_at) VALUES(?,'CHAT',?)`).run(userId, now);
  db.prepare(`INSERT OR REPLACE INTO driver_push_subscriptions(user_id,endpoint,p256dh,auth,user_agent,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?)`).run(userId, "https://push.example.test/secret-endpoint-token", "secret-p256dh", "secret-auth", "Lifecycle Test", now, now);

  db.close();

  let result = await target.client.request("/api/driver/account/export");
  assert.equal(result.response.status, 200, JSON.stringify(result.data));
  assert.equal(result.data.export.format, "PATAP-ACCOUNT-EXPORT-1");
  assert.equal(result.data.export.account.username, target.username);
  assert.equal(result.data.export.driver.profile.real_name, "Real Delete Name");
  assert.equal(result.data.export.events.preferences.enabled, 1);
  assert.equal(result.data.export.events.categories[0].category, "CHAT");
  assert.equal(result.data.export.events.pushSubscriptions[0].endpointHost, "push.example.test");
  const exportText = JSON.stringify(result.data.export);
  for (const secret of [target.password, "upload-secret-hash", "radio-secret-hash", "secret-p256dh", "secret-auth", "secret-endpoint-token", chatStorage, radioStorage, parkingStorage]) {
    assert.equal(exportText.includes(secret), false, `export leaked ${secret}`);
  }

  result = await target.client.request("/api/driver/account", {
    method: "DELETE",
    body: { password: target.password, confirmation: "WRONG" }
  });
  assert.equal(result.response.status, 400);

  result = await target.client.request("/api/driver/account", {
    method: "DELETE",
    body: { password: "wrong-password", confirmation: "DELETE" }
  });
  assert.equal(result.response.status, 403);

  result = await target.client.request("/api/driver/account", {
    method: "DELETE",
    body: { password: target.password, confirmation: "DELETE" }
  });
  assert.equal(result.response.status, 200, JSON.stringify(result.data));
  assert.equal(result.data.deleted, true);
  assert.equal(result.data.mediaCleanup.pending, 0);

  assert.equal(fs.existsSync(chatFile), false);
  assert.equal(fs.existsSync(radioFile), false);
  assert.equal(fs.existsSync(parkingFile), false);

  const verifyDb = openDb();
  const deletedUser = verifyDb.prepare("SELECT username,email,disabled,last_login_at,last_seen_at FROM users WHERE id=?").get(userId);
  assert.equal(deletedUser.disabled, 1);
  assert.match(deletedUser.username, /^deleted_[0-9a-f]+$/);
  assert.match(deletedUser.email, /^deleted\+[0-9a-f]+@deleted\.invalid$/);
  assert.equal(deletedUser.last_login_at, null);
  assert.equal(deletedUser.last_seen_at, null);
  assert.ok(verifyDb.prepare("SELECT deleted_at FROM account_tombstones WHERE user_id=?").get(userId));

  const tombstoneProfile = verifyDb.prepare("SELECT * FROM driver_profiles WHERE user_id=?").get(userId);
  assert.match(tombstoneProfile.nickname, /^Удалённый пользователь [0-9a-f]{6}$/);
  assert.equal(tombstoneProfile.driver_type, "GENERAL");
  assert.equal(tombstoneProfile.real_name, null);
  assert.equal(tombstoneProfile.vehicle, null);
  assert.equal(tombstoneProfile.country_code, null);
  assert.equal(tombstoneProfile.gps_enabled, 0);
  const privacy = verifyDb.prepare("SELECT * FROM driver_people_settings WHERE user_id=?").get(userId);
  assert.equal(privacy.discoverability, "HIDDEN");
  assert.equal(privacy.nearby_visibility, "NOBODY");
  assert.equal(privacy.contact_requests, "NOBODY");
  assert.equal(privacy.community_invites, "NOBODY");
  assert.equal(privacy.vehicle_visibility, "NOBODY");

  assert.equal(verifyDb.prepare("SELECT COUNT(*) AS n FROM driver_locations WHERE user_id=?").get(userId).n, 0);
  assert.equal(verifyDb.prepare("SELECT COUNT(*) AS n FROM sessions WHERE user_id=?").get(userId).n, 0);
  assert.equal(verifyDb.prepare("SELECT COUNT(*) AS n FROM driver_relationships WHERE requester_id=? OR target_id=?").get(userId, userId).n, 0);
  assert.equal(verifyDb.prepare("SELECT COUNT(*) AS n FROM driver_push_subscriptions WHERE user_id=?").get(userId).n, 0);
  assert.equal(verifyDb.prepare("SELECT COUNT(*) AS n FROM radio_transmissions WHERE sender_id=?").get(userId).n, 0);
  assert.equal(verifyDb.prepare("SELECT COUNT(*) AS n FROM parking_photos WHERE uploader_id=?").get(userId).n, 0);
  assert.equal(verifyDb.prepare("SELECT author_id FROM road_reports WHERE id=?").get(roadId).author_id, null);

  const storedMessage = verifyDb.prepare(`SELECT m.body,mm.deleted_at FROM chat_messages m
    LEFT JOIN chat_message_meta mm ON mm.message_id=m.id WHERE m.id=?`).get(messageId);
  assert.equal(storedMessage.body, "");
  assert.ok(storedMessage.deleted_at);
  assert.equal(verifyDb.prepare("SELECT COUNT(*) AS n FROM chat_message_attachments WHERE message_id=?").get(messageId).n, 0);
  const chat = createChatRepository(verifyDb);
  const history = chat.listMessages(peerId, Number(generalRoom.id), { after: messageId - 1, limit: 5 }, nowIso());
  const tombstoneMessage = history.messages.find((item) => item.id === messageId);
  assert.ok(tombstoneMessage);
  assert.match(tombstoneMessage.sender.nickname, /^Удалённый пользователь /);
  assert.ok(tombstoneMessage.deletedAt);
  assert.equal(tombstoneMessage.text, "");
  assert.deepEqual(verifyDb.prepare("PRAGMA foreign_key_check").all(), []);
  verifyDb.close();

  const oldLogin = new Client();
  await oldLogin.csrf();
  result = await oldLogin.request("/api/login", { method: "POST", body: { identifier: target.username, password: target.password } });
  assert.equal(result.response.status, 401);
});

test("account deletion fails closed for shared-space owners and principal Owner", async () => {
  const candidate = await registerDriver("groupowner");
  let db = openDb();
  const now = nowIso();
  const group = db.prepare("INSERT INTO chat_rooms(room_key,kind,title,created_by,created_at) VALUES(?,'DIRECT',?,?,?)")
    .run(`account-group:${runId}`, "Lifecycle owned group", candidate.user.id, now);
  const roomId = Number(group.lastInsertRowid);
  db.prepare("INSERT INTO chat_room_members(room_id,user_id,joined_at,role) VALUES(?,?,?,'OWNER')")
    .run(roomId, candidate.user.id, now);
  db.prepare(`INSERT INTO chat_room_profiles(room_id,space_kind,description,visibility,history_policy,created_by,created_at,updated_at)
    VALUES(?,'GROUP','','PRIVATE','FULL',?,?,?)`).run(roomId, candidate.user.id, now, now);
  db.close();

  let result = await candidate.client.request("/api/driver/account", {
    method: "DELETE",
    body: { password: candidate.password, confirmation: "DELETE" }
  });
  assert.equal(result.response.status, 409, JSON.stringify(result.data));
  assert.equal(result.data.error, "account_ownership_transfer_required");
  assert.equal(result.data.ownership.chatGroups, 1);

  db = openDb();
  assert.equal(db.prepare("SELECT disabled FROM users WHERE id=?").get(candidate.user.id).disabled, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM account_tombstones WHERE user_id=?").get(candidate.user.id).n, 0);
  const principal = db.prepare("SELECT user_id FROM principal_owner WHERE singleton=1").get();
  assert.ok(principal?.user_id);
  result = deleteAccountData(db, Number(principal.user_id), { nowIso, dataDir: DATA_DIR });
  assert.equal(result.status, 403);
  assert.equal(result.error, "principal_owner_protected");
  assert.equal(db.prepare("SELECT disabled FROM users WHERE id=?").get(principal.user_id).disabled, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM account_tombstones WHERE user_id=?").get(principal.user_id).n, 0);
  assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
  db.close();
});
