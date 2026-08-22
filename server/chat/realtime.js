const { WebSocketServer, WebSocket } = require("ws");

function createChatRealtime({ server, repository, getSession, allowedOrigins }) {
  if (!server || !repository || typeof getSession !== "function") {
    throw new Error("chat_realtime_invalid_options");
  }

  const origins = allowedOrigins instanceof Set ? allowedOrigins : new Set(allowedOrigins || []);
  const sockets = new Set();
  const wss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 });
  let started = false;

  function rejectUpgrade(socket, status, reason) {
    const body = JSON.stringify({ error: reason });
    socket.write(`HTTP/1.1 ${status}\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(body)}\r\nConnection: close\r\n\r\n${body}`);
    socket.destroy();
  }

  function liveSession(client) {
    const session = getSession(client.req);
    if (!session || !repository.hasProfile(session.user.id)) {
      client.ws.close(4001, "session_expired");
      return null;
    }
    return session;
  }

  function send(client, payload) {
    if (client.ws.readyState === WebSocket.OPEN) client.ws.send(JSON.stringify(payload));
  }

  function publish(event) {
    for (const client of sockets) {
      if (!client.rooms.has(event.roomId) || !liveSession(client)) continue;
      const room = repository.getRoom(event.roomId);
      const accessError = repository.roomAccessError(client.userId, room);
      if (accessError) {
        client.rooms.delete(event.roomId);
        send(client, { type: "chat.error", roomId: event.roomId, error: accessError });
        continue;
      }
      send(client, event);
    }
  }

  wss.on("connection", (ws, req, initialSession) => {
    const client = { ws, req, userId: initialSession.user.id, rooms: new Set(), lastTypingAt: 0 };
    sockets.add(client);
    send(client, { type: "chat.ready" });

    ws.on("message", (raw) => {
      const session = liveSession(client);
      if (!session) return;
      let payload;
      try {
        payload = JSON.parse(raw.toString("utf8"));
      } catch {
        return send(client, { type: "chat.error", error: "invalid_message" });
      }

      const roomId = Number(payload.roomId);
      const room = Number.isSafeInteger(roomId) ? repository.getRoom(roomId) : null;
      const accessError = repository.roomAccessError(session.user.id, room);
      if (accessError) {
        client.rooms.delete(roomId);
        return send(client, { type: "chat.error", roomId, error: accessError });
      }

      if (payload.type === "chat.subscribe") {
        client.rooms.add(roomId);
        return send(client, { type: "chat.subscribed", roomId });
      }

      if (payload.type === "chat.typing" && client.rooms.has(roomId)) {
        const now = Date.now();
        if (now - client.lastTypingAt < 1000) return;
        client.lastTypingAt = now;
        for (const peer of sockets) {
          if (peer === client || !peer.rooms.has(roomId) || !liveSession(peer)) continue;
          const peerAccessError = repository.roomAccessError(peer.userId, room);
          if (peerAccessError) {
            peer.rooms.delete(roomId);
            send(peer, { type: "chat.error", roomId, error: peerAccessError });
            continue;
          }
          send(peer, { type: "chat.typing", roomId, nickname: repository.getNickname(session.user.id) });
        }
      }
    });

    ws.on("close", () => sockets.delete(client));
    ws.on("error", () => sockets.delete(client));
  });

  function onUpgrade(req, socket, head) {
    const url = new URL(req.url, "http://127.0.0.1");
    if (url.pathname !== "/api/driver/chat/socket") return rejectUpgrade(socket, 404, "not_found");
    if (!origins.has(req.headers.origin)) return rejectUpgrade(socket, 403, "origin_rejected");
    const session = getSession(req);
    if (!session) return rejectUpgrade(socket, 401, "not_authenticated");
    if (!repository.hasProfile(session.user.id)) return rejectUpgrade(socket, 409, "driver_profile_required");
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req, session));
  }

  function start() {
    if (started) return false;
    server.on("upgrade", onUpgrade);
    started = true;
    return true;
  }

  function stop() {
    if (!started) return false;
    server.off("upgrade", onUpgrade);
    for (const client of sockets) {
      try { client.ws.close(1001, "server_shutdown"); } catch {}
    }
    sockets.clear();
    try { wss.close(); } catch {}
    started = false;
    return true;
  }

  function state() {
    return { started, connections: sockets.size };
  }

  return { publish, start, stop, state };
}

module.exports = { createChatRealtime };
