const RECONNECT_MS = 2_000;

export function createChatController({ api, onAuthLost }) {
  const navButton = document.querySelector('[data-driver-target="chat"]');
  const roomTitle = document.querySelector("#chat-room-title");
  const roomsElement = document.querySelector("#chat-rooms");
  const directHelp = document.querySelector("#chat-direct-help");
  const messagesElement = document.querySelector("#chat-messages");
  const form = document.querySelector("#chat-form");
  const input = form.elements.message;
  const state = document.querySelector("#chat-state");
  const typingState = document.querySelector("#chat-typing");
  const messages = new Map();
  const rooms = new Map();
  let profileReady = false;
  let ownNickname = "";
  let room = null;
  let socket = null;
  let reconnectTimer = null;
  let activated = false;
  let lastTypingSentAt = 0;
  let olderCursor = null;
  let typingTimer = null;

  function setState(text, kind = "") {
    state.textContent = text;
    state.dataset.state = kind;
  }

  function clearTypingState() {
    if (typingTimer !== null) window.clearTimeout(typingTimer);
    typingTimer = null;
    typingState.textContent = "";
  }

  async function copyMessage(text) {
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text);
      else {
        const temporary = document.createElement("textarea");
        temporary.value = text;
        temporary.setAttribute("readonly", "");
        temporary.style.position = "fixed";
        temporary.style.opacity = "0";
        document.body.append(temporary);
        temporary.select();
        const copied = document.execCommand?.("copy");
        temporary.remove();
        if (!copied) throw new Error("clipboard_unavailable");
      }
      setState("Сообщение скопировано.", "active");
    } catch {
      setState("Не удалось скопировать сообщение.", "error");
    }
  }

  async function deleteMessage(message) {
    if (message.sender.nickname !== ownNickname || !window.confirm("Удалить сообщение у всех?")) return;
    try {
      await api(`/api/driver/chat/messages/${message.id}`, { method: "DELETE", body: {} });
      if (messages.delete(message.id)) renderMessages({ preserveScroll: true, scrollToBottom: false });
      setState("Сообщение удалено.", "active");
    } catch (error) {
      if (error.status === 401) onAuthLost();
      else if (error.status === 404) {
        if (messages.delete(message.id)) renderMessages({ preserveScroll: true, scrollToBottom: false });
      } else setState("Не удалось удалить сообщение.", "error");
    }
  }

  function createMessageMenu(message) {
    const menu = document.createElement("details");
    menu.className = "message-menu";
    menu.addEventListener("toggle", () => {
      if (!menu.open) return;
      const boundary = menu.closest(".chat-messages")?.getBoundingClientRect();
      const trigger = menu.getBoundingClientRect();
      if (boundary) menu.classList.toggle("open-up", trigger.top - boundary.top > boundary.bottom - trigger.bottom);
    });
    const trigger = document.createElement("summary");
    trigger.setAttribute("aria-label", "Действия с сообщением");
    trigger.textContent = "⋮";
    const actions = document.createElement("div");
    const copy = document.createElement("button");
    copy.type = "button";
    copy.textContent = "Копировать";
    copy.addEventListener("click", () => {
      menu.open = false;
      copyMessage(message.text);
    });
    actions.append(copy);
    if (message.sender.nickname === ownNickname) {
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "danger";
      remove.textContent = "Удалить";
      remove.addEventListener("click", () => {
        menu.open = false;
        deleteMessage(message);
      });
      actions.append(remove);
    }
    menu.append(trigger, actions);
    return menu;
  }

  function renderMessages({ preserveScroll = false, scrollToBottom = true } = {}) {
    const previousTop = messagesElement.scrollTop;
    const previousHeight = messagesElement.scrollHeight;
    messagesElement.replaceChildren();
    if (olderCursor !== null) {
      const older = document.createElement("button");
      older.type = "button";
      older.className = "chat-load-older";
      older.textContent = "Загрузить ранее";
      older.addEventListener("click", () => loadOlder());
      messagesElement.append(older);
    }
    for (const message of Array.from(messages.values()).sort((a, b) => a.id - b.id)) {
      const item = document.createElement("article");
      item.className = "chat-message";
      item.dataset.messageId = String(message.id);
      const meta = document.createElement("div");
      meta.className = "chat-message-meta";
      const author = document.createElement("strong");
      author.textContent = message.sender.nickname;
      const time = document.createElement("time");
      time.dateTime = message.createdAt;
      time.textContent = new Date(message.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      meta.append(author, time, createMessageMenu(message));
      const body = document.createElement("p");
      body.textContent = message.text;
      item.append(meta, body);
      messagesElement.append(item);
    }
    if (preserveScroll) messagesElement.scrollTop = previousTop + (messagesElement.scrollHeight - previousHeight);
    else if (scrollToBottom) messagesElement.scrollTop = messagesElement.scrollHeight;
  }

  function addMessages(items, options) {
    let changed = false;
    for (const message of items || []) {
      if (!messages.has(message.id)) changed = true;
      messages.set(message.id, message);
    }
    if (changed) renderMessages(options);
  }

  function renderRooms() {
    roomsElement.replaceChildren();
    for (const item of rooms.values()) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = item.kind === "DIRECT" ? `Личный: ${item.title}` : item.title;
      button.classList.toggle("active", item.id === room?.id);
      button.disabled = item.id === room?.id;
      button.addEventListener("click", () => selectRoom(item));
      roomsElement.append(button);
    }
    directHelp.hidden = Array.from(rooms.values()).some((item) => item.kind === "DIRECT");
  }

  async function loadRooms() {
    const data = await api("/api/driver/chat/rooms");
    rooms.clear();
    for (const item of data.rooms || []) rooms.set(item.id, item);
    return data.rooms || [];
  }

  function closeSocket() {
    if (reconnectTimer) window.clearTimeout(reconnectTimer);
    reconnectTimer = null;
    const previous = socket;
    socket = null;
    if (previous) previous.close();
  }

  function handleBlockedRoom() {
    if (room?.kind !== "DIRECT") return;
    rooms.delete(room.id);
    room = null;
    messages.clear();
    clearTypingState();
    closeSocket();
    renderMessages();
    renderRooms();
    setState("Личный чат недоступен: связь между водителями заблокирована.", "error");
  }

  async function selectRoom(nextRoom) {
    if (!nextRoom) return;
    room = nextRoom;
    messages.clear();
    olderCursor = null;
    clearTypingState();
    closeSocket();
    roomTitle.textContent = room.kind === "DIRECT" ? `Личный чат: ${room.title}` : room.title;
    renderRooms();
    if (!activated) return;
    await syncMessages();
    connectSocket();
  }

  async function syncMessages(after = null) {
    if (!room) return;
    const suffix = after === null ? "" : `?after=${after}&limit=100`;
    try {
      const data = await api(`/api/driver/chat/rooms/${room.id}/messages${suffix}`);
      addMessages(data.messages);
      if (after === null) {
        olderCursor = data.hasOlder ? data.previousCursor : null;
        renderMessages();
      }
      setState(socket?.readyState === WebSocket.OPEN ? "Чат подключён" : "История загружена. Realtime переподключается…", socket?.readyState === WebSocket.OPEN ? "active" : "offline");
    } catch (error) {
      if (error.status === 401) onAuthLost();
      else if (error.message === "driver_blocked") handleBlockedRoom();
      else setState("Не удалось обновить сообщения.", "error");
    }
  }

  async function loadOlder() {
    if (!room || olderCursor === null) return;
    const before = olderCursor;
    try {
      const data = await api(`/api/driver/chat/rooms/${room.id}/messages?before=${before}&limit=100`);
      olderCursor = data.hasOlder ? data.previousCursor : null;
      addMessages(data.messages, { preserveScroll: true, scrollToBottom: false });
    } catch (error) {
      if (error.status === 401) onAuthLost();
      else if (error.message === "driver_blocked") handleBlockedRoom();
      else setState("Не удалось загрузить более ранние сообщения.", "error");
    }
  }

  function scheduleReconnect() {
    if (!activated || !profileReady || reconnectTimer) return;
    setState("Связь потеряна. Переподключаемся…", "offline");
    reconnectTimer = window.setTimeout(() => {
      reconnectTimer = null;
      connectSocket();
    }, RECONNECT_MS);
  }

  function connectSocket() {
    if (!room || !activated || !profileReady || socket?.readyState === WebSocket.OPEN || socket?.readyState === WebSocket.CONNECTING) return;
    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    const currentSocket = new WebSocket(`${protocol}//${location.host}/api/driver/chat/socket`);
    socket = currentSocket;
    currentSocket.addEventListener("open", () => {
      setState("Подключаем общий чат…");
      currentSocket.send(JSON.stringify({ type: "chat.subscribe", roomId: room.id }));
    });
    currentSocket.addEventListener("message", (event) => {
      let payload;
      try { payload = JSON.parse(event.data); } catch { return; }
      if (payload.type === "chat.subscribed" && payload.roomId === room.id) {
        const cursor = messages.size ? Math.max(...messages.keys()) : 0;
        syncMessages(cursor);
      } else if (payload.type === "chat.message.committed" && payload.roomId === room.id) {
        addMessages([payload.message]);
      } else if (payload.type === "chat.message.deleted" && payload.roomId === room.id) {
        if (messages.delete(payload.messageId)) renderMessages({ preserveScroll: true, scrollToBottom: false });
      } else if (payload.type === "chat.typing" && payload.roomId === room.id) {
        typingState.textContent = `${payload.nickname} печатает…`;
        if (typingTimer !== null) window.clearTimeout(typingTimer);
        typingTimer = window.setTimeout(() => {
          typingState.textContent = "";
          typingTimer = null;
        }, 1800);
      } else if (payload.type === "chat.error" && payload.error === "driver_blocked") {
        handleBlockedRoom();
      }
    });
    currentSocket.addEventListener("close", () => { if (socket === currentSocket) scheduleReconnect(); });
    currentSocket.addEventListener("error", () => currentSocket.close());
  }

  async function activate() {
    activated = true;
    if (!profileReady) return setState("Сначала сохраните профиль водителя.", "error");
    if (!room) {
      setState("Загружаем общий чат…");
      try {
        const available = await loadRooms();
        const initial = available.find((item) => item.key === "general") || available[0];
        if (!initial) return setState("Общий чат пока недоступен.", "error");
        await selectRoom(initial);
      } catch (error) {
        if (error.status === 401) onAuthLost();
        else setState("Не удалось загрузить чат.", "error");
        return;
      }
    } else {
      await syncMessages();
      connectSocket();
    }
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const text = input.value.trim();
    if (!text || !room) return;
    const submit = form.querySelector("button[type=submit]");
    submit.disabled = true;
    const clientMessageId = globalThis.crypto?.randomUUID
      ? crypto.randomUUID().replaceAll("-", "_")
      : `msg_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    try {
      const data = await api(`/api/driver/chat/rooms/${room.id}/messages`, { method: "POST", body: { clientMessageId, text } });
      addMessages([data.message]);
      input.value = "";
    } catch (error) {
      if (error.status === 401) onAuthLost();
      else if (error.message === "driver_blocked") handleBlockedRoom();
      else setState("Сообщение не отправлено. Текст сохранён в поле.", "error");
    } finally {
      submit.disabled = false;
    }
  });

  input.addEventListener("input", () => {
    const now = Date.now();
    if (!room || socket?.readyState !== WebSocket.OPEN || now - lastTypingSentAt < 1200) return;
    lastTypingSentAt = now;
    socket.send(JSON.stringify({ type: "chat.typing", roomId: room.id }));
  });

  return {
    activate,
    setSession({ profile }) {
      profileReady = Boolean(profile);
      ownNickname = profile?.nickname || "";
      navButton.disabled = !profileReady;
      navButton.title = profileReady ? "" : "Сначала сохраните профиль";
    },
    setProfileReady(value) {
      profileReady = Boolean(value);
      ownNickname = value?.nickname || ownNickname;
      navButton.disabled = !profileReady;
    },
    async openDirect(nickname) {
      if (!profileReady) return setState("Сначала сохраните профиль водителя.", "error");
      try {
        const data = await api("/api/driver/chat/direct", { method: "POST", body: { nickname } });
        await loadRooms();
        rooms.set(data.room.id, data.room);
        await selectRoom(data.room);
      } catch (error) {
        setState(error.message === "driver_not_found" ? "Водитель больше недоступен." : error.message === "driver_blocked" ? "Личный чат недоступен: связь между водителями заблокирована." : "Не удалось открыть личный чат.", "error");
        throw error;
      }
    },
    reset() {
      activated = false;
      profileReady = false;
      ownNickname = "";
      room = null;
      rooms.clear();
      messages.clear();
      olderCursor = null;
      clearTypingState();
      renderMessages();
      navButton.disabled = true;
      closeSocket();
      setState("Чат отключён");
    }
  };
}

export function createDriverModule(context) {
  const controller = createChatController({ api: context.api, onAuthLost: context.onAuthLost });
  return {
    controller,
    setSession({ profile }) { controller.setSession({ profile }); },
    setProfileReady(profile) { controller.setProfileReady(profile); },
    activate() { return controller.activate(); },
    openDirect(nickname) { return controller.openDirect(nickname); },
    reset() { controller.reset(); }
  };
}
