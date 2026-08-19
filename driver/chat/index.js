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

function withChatV2Api(api, expiryForRoom = () => 0) {
  return (pathname, options) => {
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
    return api(next, nextOptions);
  };
}

export function createChatController(options) {
  return createBaseChatController({ ...options, api: withChatV2Api(options.api) });
}

export function createDriverModule(context) {
  let advanced = null;
  const proxiedApi = withChatV2Api(context.api, (roomId) => advanced?.expirySeconds(roomId) || 0);
  const module = createBaseDriverModule({ ...context, api: proxiedApi });
  advanced = createChatAdvanced({
    card: document.querySelector("#chat-view .chat-card"),
    api: proxiedApi,
    openDirectRadio: context.openDirectRadio,
    showError: context.showError
  });
  return module;
}

export { CHAT_REACTIONS, reactionView };
