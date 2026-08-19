import {
  CHAT_REACTIONS,
  reactionView,
  createChatController as createBaseChatController,
  createDriverModule as createBaseDriverModule
} from "./index-v2.js";
import { createChatAdvanced } from "./advanced.mjs";

function messageRoomId(pathname) {
  const match = String(pathname || "").match(/^\/api\/driver\/chat\/rooms\/(\d+)\/messages(?:\?|$)/);
  return match ? Number(match[1]) : null;
}

function roomDetailsId(pathname) {
  const match = String(pathname || "").match(/^\/api\/driver\/chat\/rooms\/(\d+)(?:\?|$)/);
  return match ? Number(match[1]) : null;
}

function createChatV2Api(api, { expiryForRoom = () => 0, onRoomChanged = () => {}, onOverview = () => {} } = {}) {
  const roomCache = new Map();
  return async (pathname, options) => {
    let next = pathname;
    let nextOptions = options;
    const method = String(options?.method || "GET").toUpperCase();
    const roomId = messageRoomId(next);
    if (method === "GET" && roomId !== null && !/[?&]includeDeleted=/.test(next)) {
      next += next.includes("?") ? "&includeDeleted=1" : "?includeDeleted=1";
    }
    if (method === "POST" && roomId !== null && options?.body && options.body.expiresInSeconds === undefined) {
      const expiresInSeconds = Number(expiryForRoom(roomId) || 0);
      if (expiresInSeconds > 0) nextOptions = { ...options, body: { ...options.body, expiresInSeconds } };
    }

    const result = await api(next, nextOptions);
    if (pathname === "/api/driver/chat/overview" && Array.isArray(result?.rooms)) {
      roomCache.clear();
      for (const room of result.rooms) roomCache.set(Number(room.id), room);
      onOverview(result.rooms);
    }
    if (result?.room?.id) roomCache.set(Number(result.room.id), result.room);
    const detailsId = method === "GET" ? roomDetailsId(pathname) : null;
    if (detailsId !== null && result?.room) roomCache.set(detailsId, result.room);
    if (roomId !== null && method === "GET") {
      const active = roomCache.get(roomId);
      if (active) onRoomChanged(active);
    } else if (result?.room?.id && ["POST", "GET"].includes(method)) {
      onRoomChanged(roomCache.get(Number(result.room.id)));
    }
    return result;
  };
}

export function createChatController(options) {
  return createBaseChatController({ ...options, api: createChatV2Api(options.api) });
}

export function createDriverModule(context) {
  const card = document.querySelector("#chat-view .chat-card");
  let advanced = null;
  let latestRooms = [];
  const dispatchRoom = (room) => card?.dispatchEvent(new CustomEvent("patap:chat-room-changed", { detail: { room } }));
  const proxiedApi = createChatV2Api(context.api, {
    expiryForRoom: (roomId) => advanced?.expirySeconds(roomId) || 0,
    onRoomChanged: dispatchRoom,
    onOverview: (rooms) => { latestRooms = Array.isArray(rooms) ? rooms.slice() : []; }
  });
  const module = createBaseDriverModule({ ...context, api: proxiedApi });
  advanced = createChatAdvanced({
    card,
    api: proxiedApi,
    openDirectRadio: context.openDirectRadio,
    showError: context.showError
  });

  async function openRoom(roomId) {
    const id = Number(roomId);
    if (!Number.isSafeInteger(id) || id <= 0) throw new Error("chat_room_not_found");
    await module.activate();
    if (!latestRooms.some((room) => Number(room.id) === id)) await proxiedApi("/api/driver/chat/overview");
    const visible = latestRooms.filter((room) => !room.archived);
    const index = visible.findIndex((room) => Number(room.id) === id);
    if (index < 0) throw new Error("chat_room_not_found");
    const roomSearch = card?.querySelector(".chat-room-search input");
    if (roomSearch?.value) {
      roomSearch.value = "";
      roomSearch.dispatchEvent(new Event("input", { bubbles: true }));
    }
    const allFilter = card?.querySelector('.chat-room-filters button[data-filter="ALL"]');
    allFilter?.click();
    const rows = [...(card?.querySelectorAll(".chat-room-row") || [])];
    const target = rows[index];
    if (!target) throw new Error("chat_room_not_found");
    target.click();
    return visible[index];
  }

  document.addEventListener("patap:open-chat-room", (event) => {
    const id = Number(event.detail?.roomId);
    if (!Number.isSafeInteger(id) || id <= 0) return;
    document.querySelector('[data-driver-target="chat"]')?.click();
    Promise.resolve(openRoom(id)).catch(() => context.showError?.("Не удалось открыть чат сообщества."));
  });

  return {
    ...module,
    openRoom,
    async reset() {
      latestRooms = [];
      dispatchRoom(null);
      return module.reset();
    }
  };
}

export { CHAT_REACTIONS, reactionView };
