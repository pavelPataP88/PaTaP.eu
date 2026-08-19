const test = require("node:test");
const assert = require("node:assert/strict");

const runId = process.env.PATAP_TEST_RUN_ID;
const baseUrl = process.env.PATAP_AUTH_BASE_URL;
if (!runId || !baseUrl || !process.env.PATAP_DB_PATH || !process.env.PATAP_AUTH_SECRET_PATH) {
  throw new Error("Auth tests must be started through scripts/run-auth-tests.js");
}

let identitySequence = 0;
let ipSequence = 40;

class Client {
  constructor() {
    this.cookies = {};
    this.csrfToken = null;
    this.clientIp = `198.51.100.${++ipSequence}`;
  }
  cookieHeader() { return Object.entries(this.cookies).map(([key,value]) => `${key}=${value}`).join("; "); }
  storeCookies(headers) {
    for (const value of headers.getSetCookie ? headers.getSetCookie() : []) {
      const [pair] = value.split(";"); const index = pair.indexOf("="); const key = pair.slice(0,index); const raw = pair.slice(index+1);
      if (raw === "") delete this.cookies[key]; else this.cookies[key] = raw;
    }
  }
  headers(extra = {}) {
    const headers = { Origin: "http://127.0.0.1:8090", "CF-Connecting-IP": this.clientIp, ...extra };
    const cookie = this.cookieHeader(); if (cookie) headers.Cookie = cookie;
    if (this.csrfToken) headers["X-CSRF-Token"] = this.csrfToken;
    return headers;
  }
  async request(pathname, options = {}) {
    const headers = this.headers({ Accept: "application/json", ...(options.headers || {}) });
    if (options.body !== undefined) headers["Content-Type"] = "application/json";
    const response = await fetch(`${baseUrl}${pathname}`, { ...options, headers, body: options.body === undefined ? undefined : JSON.stringify(options.body) });
    this.storeCookies(response.headers);
    const data = await response.json().catch(() => ({})); if (data.csrfToken) this.csrfToken = data.csrfToken;
    return { response, data };
  }
  async csrf() { return this.request("/api/csrf"); }
  async binary(pathname, bytes, headers = {}) {
    const response = await fetch(`${baseUrl}${pathname}`, { method: "POST", headers: this.headers(headers), body: bytes });
    this.storeCookies(response.headers); return response;
  }
  async raw(pathname, headers = {}) {
    const response = await fetch(`${baseUrl}${pathname}`, { headers: this.headers(headers) });
    return response;
  }
}

async function createDriver(label) {
  const client = new Client();
  const seq = ++identitySequence;
  const suffix = `${label}_${seq}_${String(runId).slice(-8)}`;
  const username = `cv2_${suffix}`.toLowerCase().replace(/[^a-z0-9_-]/g,"_").slice(0,32);
  const nickname = `ChatV2_${label}_${seq}_${String(runId).slice(-6)}`.slice(0,32);
  await client.csrf();
  let result = await client.request("/api/register", { method: "POST", body: { username, email: `${username}@patap.test`, password: "chat-console-123", confirmPassword: "chat-console-123" } });
  assert.equal(result.response.status,201);
  result = await client.request("/api/driver/profile", { method: "PUT", body: { nickname, driverType: "TIR", countryCode: "PL" } });
  assert.ok([200,201].includes(result.response.status));
  return { client, nickname };
}

async function makeContacts(left,right) {
  let result = await left.client.request(`/api/driver/drivers/${encodeURIComponent(right.nickname)}/contact`, { method: "POST", body: {} });
  assert.equal(result.response.status,200);
  result = await right.client.request(`/api/driver/drivers/${encodeURIComponent(left.nickname)}/contact`, { method: "POST", body: {} });
  assert.equal(result.response.status,200);
  assert.equal(result.data.driver.relationship,"CONTACT");
}

function clientMessageId(prefix) { return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2)}`.replace(/[^A-Za-z0-9_-]/g,"_"); }

async function sendText(driver, roomId, text, extra = {}) {
  const result = await driver.client.request(`/api/driver/chat/rooms/${roomId}/messages`, { method: "POST", body: { clientMessageId: clientMessageId("msg"), text, ...extra } });
  assert.equal(result.response.status,201);
  return result.data.message;
}

test("Chat Console V2 supports group roles, rich messages, cross-room forwarding, media, receipts, polls and room state", async () => {
  const owner = await createDriver("owner");
  const member = await createDriver("member");
  const outsider = await createDriver("outsider");
  await makeContacts(owner,member);

  let result = await owner.client.request("/api/driver/chat/overview");
  assert.equal(result.response.status,200);
  const general = result.data.rooms.find((room) => room.kind === "GENERAL");
  assert.ok(general);

  result = await owner.client.request("/api/driver/chat/groups", { method: "POST", body: { title: "TIR Private Test", description: "Закрытая тестовая группа", visibility: "PRIVATE", historyPolicy: "FULL" } });
  assert.equal(result.response.status,201);
  const group = result.data.room;
  assert.equal(group.kind,"GROUP");
  assert.equal(group.role,"OWNER");

  result = await outsider.client.request("/api/driver/chat/groups/discover?q=TIR");
  assert.equal(result.response.status,200);
  assert.equal(result.data.groups.some((item) => item.id === group.id),false);

  result = await owner.client.request(`/api/driver/chat/groups/${group.id}/invites`, { method: "POST", body: { nickname: member.nickname } });
  assert.equal(result.response.status,200);
  result = await owner.client.request(`/api/driver/chat/groups/${group.id}/invites`, { method: "POST", body: { nickname: outsider.nickname } });
  assert.equal(result.response.status,403);
  assert.equal(result.data.error,"chat_contact_required");

  result = await member.client.request("/api/driver/chat/overview");
  assert.equal(result.data.invites.some((invite) => invite.roomId === group.id),true);
  result = await member.client.request(`/api/driver/chat/invites/${group.id}/respond`, { method: "POST", body: { action: "ACCEPT" } });
  assert.equal(result.response.status,200);

  result = await owner.client.request(`/api/driver/chat/groups/${group.id}/members/${encodeURIComponent(member.nickname)}`, { method: "PATCH", body: { role: "READONLY" } });
  assert.equal(result.response.status,200);
  result = await member.client.request(`/api/driver/chat/rooms/${group.id}/messages`, { method: "POST", body: { clientMessageId: clientMessageId("blocked"), text: "Это не должно уйти" } });
  assert.equal(result.response.status,403);
  assert.equal(result.data.error,"chat_readonly");
  result = await member.client.request("/api/driver/chat/uploads", { method: "POST", body: { roomId: group.id, kind: "FILE", fileName: "blocked.pdf", mimeType: "application/pdf", byteLength: 4 } });
  assert.equal(result.response.status,403);
  assert.equal(result.data.error,"chat_readonly");

  result = await owner.client.request(`/api/driver/chat/groups/${group.id}/members/${encodeURIComponent(member.nickname)}`, { method: "PATCH", body: { role: "MEMBER" } });
  assert.equal(result.response.status,200);

  const origin = await sendText(owner, group.id, "Пробка после Твери, держитесь правее");
  const reply = await sendText(member, group.id, "Принял, спасибо", { replyToMessageId: origin.id });
  assert.equal(reply.replyTo.id,origin.id);
  assert.equal(reply.replyTo.sender,owner.nickname);

  result = await member.client.request(`/api/driver/chat/messages/${reply.id}`, { method: "PATCH", body: { text: "Принял, спасибо!" } });
  assert.equal(result.response.status,200);
  assert.equal(result.data.message.text,"Принял, спасибо!");
  assert.ok(result.data.message.editedAt);

  result = await member.client.request(`/api/driver/chat/rooms/${general.id}/messages`, { method: "POST", body: { clientMessageId: clientMessageId("forward"), text: "", forwardFromMessageId: origin.id } });
  assert.equal(result.response.status,201);
  assert.equal(result.data.message.roomId,general.id);
  assert.equal(result.data.message.forwardedFrom.id,origin.id);
  assert.equal(result.data.message.forwardedFrom.sender,owner.nickname);
  assert.equal(result.data.message.text,origin.text);

  const pdf = Buffer.from("%PDF-chat-console-v2-test");
  result = await member.client.request("/api/driver/chat/uploads", { method: "POST", body: { roomId: group.id, kind: "FILE", fileName: "route.pdf", mimeType: "application/pdf", byteLength: pdf.length } });
  assert.equal(result.response.status,201);
  const prepared = result.data;
  let response = await member.client.binary(prepared.uploadUrl,pdf,{ "Content-Type": "application/pdf", "X-Chat-Upload-Token": prepared.uploadToken });
  assert.equal(response.status,201);
  result = await member.client.request(`/api/driver/chat/rooms/${group.id}/messages`, { method: "POST", body: { clientMessageId: clientMessageId("file"), text: "Документ маршрута", uploadIds: [prepared.upload.id] } });
  assert.equal(result.response.status,201);
  const fileMessage = result.data.message;
  assert.equal(fileMessage.attachments.length,1);
  assert.equal(fileMessage.attachments[0].fileName,"route.pdf");
  response = await owner.client.raw(`/api/driver/chat/attachments/${fileMessage.attachments[0].id}/content`, { Range: "bytes=0-3" });
  assert.equal(response.status,206);
  assert.equal(Buffer.from(await response.arrayBuffer()).toString("utf8"),"%PDF");
  assert.match(response.headers.get("content-range") || "",/^bytes 0-3\//);

  result = await owner.client.request(`/api/driver/chat/rooms/${group.id}/polls`, { method: "POST", body: { clientMessageId: clientMessageId("poll"), question: "Где встречаемся?", options: ["Катовице","Краков","Вроцлав"], multiple: false } });
  assert.equal(result.response.status,201);
  const pollMessage = result.data.message;
  assert.equal(pollMessage.poll.options.length,3);
  const selected = pollMessage.poll.options[1].id;
  result = await member.client.request(`/api/driver/chat/polls/${pollMessage.id}/vote`, { method: "POST", body: { optionIds: [selected] } });
  assert.equal(result.response.status,200);
  assert.equal(result.data.poll.options.find((option) => option.id === selected).votes,1);
  assert.equal(result.data.poll.options.find((option) => option.id === selected).votedByMe,true);

  result = await owner.client.request(`/api/driver/chat/rooms/${group.id}/pins/${origin.id}`, { method: "POST", body: {} });
  assert.equal(result.response.status,200);
  result = await member.client.request(`/api/driver/chat/rooms/${group.id}/pins`);
  assert.equal(result.response.status,200);
  assert.equal(result.data.pins.some((message) => message.id === origin.id),true);

  result = await member.client.request(`/api/driver/chat/rooms/${group.id}/read`, { method: "POST", body: { messageId: pollMessage.id } });
  assert.equal(result.response.status,200);
  result = await owner.client.request(`/api/driver/chat/rooms/${group.id}/messages?after=${Math.max(0,origin.id-1)}&limit=20`);
  assert.equal(result.response.status,200);
  const ownerOrigin = result.data.messages.find((message) => message.id === origin.id);
  assert.ok(ownerOrigin.receipts.read >= 1);
  assert.ok(ownerOrigin.receipts.delivered >= 1);

  result = await member.client.request(`/api/driver/chat/rooms/${group.id}/draft`, { method: "PUT", body: { text: "Черновик для рейса", replyToMessageId: origin.id } });
  assert.equal(result.response.status,200);
  result = await member.client.request(`/api/driver/chat/rooms/${group.id}/preferences`, { method: "PATCH", body: { favorite: true, archived: true, pinnedRank: 0, notificationLevel: "MENTIONS" } });
  assert.equal(result.response.status,200);
  result = await member.client.request("/api/driver/chat/overview");
  const memberRoom = result.data.rooms.find((item) => item.id === group.id);
  assert.equal(memberRoom.favorite,true);
  assert.equal(memberRoom.archived,true);
  assert.equal(memberRoom.pinnedRank,0);
  assert.equal(memberRoom.notificationLevel,"MENTIONS");
  assert.equal(memberRoom.draft.text,"Черновик для рейса");

  result = await member.client.request(`/api/driver/chat/search?q=${encodeURIComponent("Твери")}&roomId=${group.id}`);
  assert.equal(result.response.status,200);
  assert.equal(result.data.messages.some((message) => message.id === origin.id),true);

  result = await member.client.request(`/api/driver/chat/messages/${reply.id}`, { method: "DELETE", body: { scope: "me" } });
  assert.equal(result.response.status,200);
  result = await member.client.request(`/api/driver/chat/rooms/${group.id}/messages?limit=100`);
  assert.equal(result.data.messages.some((message) => message.id === reply.id),false);
  result = await owner.client.request(`/api/driver/chat/rooms/${group.id}/messages?limit=100`);
  assert.equal(result.data.messages.some((message) => message.id === reply.id),true);

  result = await owner.client.request(`/api/driver/chat/messages/${reply.id}`, { method: "DELETE", body: { scope: "everyone" } });
  assert.equal(result.response.status,200);
  result = await owner.client.request(`/api/driver/chat/rooms/${group.id}/messages?limit=100`);
  const tombstone = result.data.messages.find((message) => message.id === reply.id);
  assert.ok(tombstone);
  assert.ok(tombstone.deletedAt);
  assert.equal(tombstone.text,"");

  result = await owner.client.request("/api/driver/chat/direct", { method: "POST", body: { nickname: member.nickname } });
  assert.ok([200,201].includes(result.response.status));
  assert.equal(result.data.room.kind,"DIRECT");
});
