import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { EventEmitter } from "node:events";

const root = path.resolve(import.meta.dirname, "../..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const require = createRequire(import.meta.url);
const { createChatRealtime } = require("../../server/chat/realtime");

test("Driver runtime owns deterministic domain bootstrap and dispatcher lifecycle", () => {
  const facade = read("server/driver/routes.js");
  const routes = read("server/driver/http-routes.js");
  const runtime = read("server/driver/runtime.js");

  assert.match(facade, /require\("\.\/http-routes"\)/);
  assert.match(routes, /createDriverRuntime/);
  assert.match(routes, /handleDriverRoute\.start = runtime\.start/);
  assert.match(routes, /handleDriverRoute\.stop = runtime\.stop/);
  assert.doesNotMatch(routes, /dispatcher\.start\(\)/);

  const parkingAt = runtime.indexOf("createParkingRoutes(routeOptions)");
  const peopleAt = runtime.indexOf("createPeopleRoutes(routeOptions)");
  const eventsAt = runtime.indexOf("createEventRuntime({ db, nowIso })");
  assert.ok(parkingAt >= 0 && peopleAt > parkingAt && eventsAt > peopleAt);
  assert.match(runtime, /function start\(\)[\s\S]*eventRuntime\.dispatcher\.start\(\)/);
  assert.match(runtime, /function stop\(\)[\s\S]*eventRuntime\.dispatcher\.stop\(\)/);
});

test("auth entrypoint no longer contains Chat WebSocket business logic", () => {
  const entry = read("server/auth/server.js");
  const httpServer = read("server/auth/http-server.js");
  const realtime = read("server/chat/realtime.js");

  assert.equal(entry.trim(), 'require("./http-server");');
  assert.doesNotMatch(httpServer, /WebSocketServer|chatSockets|server\.on\("upgrade"/);
  assert.match(httpServer, /createChatRealtime/);
  assert.match(httpServer, /publishChatEvent = chatRealtime\.publish/);
  assert.match(httpServer, /handleDriverRoute\.stop\?\.\(\)/);
  assert.match(httpServer, /chatRealtime\.stop\(\)/);

  assert.match(realtime, /new WebSocketServer\(\{ noServer: true, maxPayload: 16 \* 1024 \}\)/);
  assert.match(realtime, /\/api\/driver\/chat\/socket/);
  assert.match(realtime, /origin_rejected/);
  assert.match(realtime, /session_expired/);
  assert.match(realtime, /chat\.typing/);
});

test("Chat realtime lifecycle attaches and detaches the upgrade boundary idempotently", () => {
  const server = new EventEmitter();
  const repository = {
    hasProfile: () => true,
    getRoom: () => ({ id: 1 }),
    roomAccessError: () => null,
    getNickname: () => "driver"
  };
  const realtime = createChatRealtime({
    server,
    repository,
    getSession: () => ({ user: { id: 1 } }),
    allowedOrigins: new Set(["https://driver.patap.eu"])
  });

  assert.deepEqual(realtime.state(), { started: false, connections: 0 });
  assert.equal(realtime.start(), true);
  assert.equal(realtime.start(), false);
  assert.equal(server.listenerCount("upgrade"), 1);
  assert.deepEqual(realtime.state(), { started: true, connections: 0 });
  assert.equal(realtime.stop(), true);
  assert.equal(realtime.stop(), false);
  assert.equal(server.listenerCount("upgrade"), 0);
  assert.deepEqual(realtime.state(), { started: false, connections: 0 });
});
