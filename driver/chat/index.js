import {
  CHAT_REACTIONS,
  reactionView,
  createChatController as createBaseChatController,
  createDriverModule as createBaseDriverModule
} from "./index-v2.js";

function withChatV2Api(api) {
  return (pathname, options) => {
    let next = pathname;
    const method = String(options?.method || "GET").toUpperCase();
    if (method === "GET" && /^\/api\/driver\/chat\/rooms\/\d+\/messages(?:\?|$)/.test(next) && !/[?&]includeDeleted=/.test(next)) {
      next += next.includes("?") ? "&includeDeleted=1" : "?includeDeleted=1";
    }
    return api(next, options);
  };
}

export function createChatController(options) {
  return createBaseChatController({ ...options, api: withChatV2Api(options.api) });
}

export function createDriverModule(context) {
  return createBaseDriverModule({ ...context, api: withChatV2Api(context.api) });
}

export { CHAT_REACTIONS, reactionView };
