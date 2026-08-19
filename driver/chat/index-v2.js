import { createChatConsoleUi } from "./console.mjs";
import { attachmentKind, createVoiceRecorder, formatBytes, formatDuration } from "./media.mjs";

const RECONNECT_MS = 2_000;
const OVERVIEW_POLL_MS = 12_000;
const DRAFT_SAVE_MS = 700;
const MAX_PENDING_ATTACHMENTS = 10;

export const CHAT_REACTIONS = Object.freeze([
  { key: "👍", label: "Понял" }, { key: "❤️", label: "Поддерживаю" }, { key: "😂", label: "Смешно" },
  { key: "😮", label: "Удивлён" }, { key: "😢", label: "Сочувствую" }, { key: "🙏", label: "Спасибо" },
  { key: "🔥", label: "Огонь" }, { key: "✅", label: "Подтверждаю" }, { key: "👀", label: "Проверяю" },
  { key: "👎", label: "Не согласен" }, { key: "🎉", label: "Отлично" }, { key: "💯", label: "Сто процентов" }
]);

export function reactionView(reactions, key) {
  const option = CHAT_REACTIONS.find((item) => item.key === key);
  const current = (reactions || []).find((item) => item.key === key);
  const people = Array.isArray(current?.people) ? current.people.filter(Boolean) : [];
  const count = Number.isSafeInteger(current?.count) ? current.count : people.length;
  const label = option?.label || "Реакция";
  return { key, label, count, people, reactedByMe: Boolean(current?.reactedByMe), title: people.length ? `${label}: ${people.join(", ")}` : label };
}

function randomId(prefix = "msg") {
  return globalThis.crypto?.randomUUID ? `${prefix}_${crypto.randomUUID().replaceAll("-", "_")}` : `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}
function escapeRegExp(value) { return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
function isNearBottom(element) { return element.scrollHeight - element.scrollTop - element.clientHeight < 90; }
function canEditLocally(message, ownNickname) { return message?.sender?.nickname === ownNickname && !message.deletedAt && Date.now() - Date.parse(message.createdAt) <= 15 * 60 * 1000 && !message.poll; }

export function createChatController({ api, uploadBinary, onAuthLost }) {
  const navButton = document.querySelector('[data-driver-target="chat"]');
  const card = document.querySelector("#chat-view .chat-card");
  const roomTitle = document.querySelector("#chat-room-title");
  const roomsElement = document.querySelector("#chat-rooms");
  const messagesElement = document.querySelector("#chat-messages");
  const form = document.querySelector("#chat-form");
  const state = document.querySelector("#chat-state");
  const typingState = document.querySelector("#chat-typing");
  const directHelp = document.querySelector("#chat-direct-help");
  directHelp.hidden = true;
  const ui = createChatConsoleUi({ card, roomTitle, roomsElement, messagesElement, form, typingElement: typingState, stateElement: state });
  const rooms = new Map();
  const messages = new Map();
  let room = null;
  let profileReady = false;
  let ownNickname = "";
  let socket = null;
  let reconnectTimer = null;
  let overviewTimer = null;
  let draftTimer = null;
  let typingTimer = null;
  let lastTypingSentAt = 0;
  let olderCursor = null;
  let activated = false;
  let currentInvites = [];
  let replyMessage = null;
  let editingMessage = null;
  let pendingUploads = [];
  let voiceReady = null;

  const voiceRecorder = createVoiceRecorder({
    onState(next) {
      if (next === "recording") ui.setVoice(true, { elapsed: formatDuration(voiceRecorder.elapsed()), paused: false });
      else if (next === "paused") ui.setVoice(true, { elapsed: formatDuration(voiceRecorder.elapsed()), paused: true });
      else if (["cancelled", "ready", "error"].includes(next)) ui.setVoice(false);
    },
    onTick(milliseconds) { if (voiceRecorder.isActive()) ui.setVoice(true, { elapsed: formatDuration(milliseconds), paused: voiceRecorder.isPaused() }); }
  });

  function setState(text, kind = "") { ui.setConnection(text, kind); }
  function handleError(error, fallback) {
    if (error?.status === 401) onAuthLost();
    else if (error?.message === "driver_blocked") handleBlockedRoom();
    else setState(fallback, "error");
  }
  function clearTyping() {
    if (typingTimer !== null) window.clearTimeout(typingTimer);
    typingTimer = null;
    ui.setTyping("");
  }
  function currentSortedMessages() { return Array.from(messages.values()).sort((a, b) => a.id - b.id); }
  function messageById(id) { return messages.get(Number(id)) || null; }

  function appendTextWithMentions(parent, text) {
    const input = String(text || "");
    const regex = /(https?:\/\/[^\s]+|@[\p{L}\p{N}_-]{2,32})/gu;
    let cursor = 0;
    for (const match of input.matchAll(regex)) {
      if (match.index > cursor) parent.append(document.createTextNode(input.slice(cursor, match.index)));
      if (match[0].startsWith("http")) {
        const link = document.createElement("a"); link.href = match[0]; link.target = "_blank"; link.rel = "noreferrer noopener"; link.textContent = match[0]; parent.append(link);
      } else {
        const mention = document.createElement("span"); mention.style.color = "var(--accent)"; mention.style.fontWeight = "800"; mention.textContent = match[0]; parent.append(mention);
      }
      cursor = match.index + match[0].length;
    }
    if (cursor < input.length) parent.append(document.createTextNode(input.slice(cursor)));
  }

  function scrollToMessage(messageId) {
    const node = messagesElement.querySelector(`[data-message-id="${Number(messageId)}"]`);
    if (!node) return false;
    node.scrollIntoView({ block: "center", behavior: "smooth" });
    node.animate?.([{ boxShadow: "0 0 0 0 rgba(104,224,173,.5)" }, { boxShadow: "0 0 0 5px rgba(104,224,173,.25)" }, { boxShadow: "0 0 0 0 rgba(104,224,173,0)" }], { duration: 900 });
    return true;
  }

  function createAttachmentNode(attachment) {
    const wrap = document.createElement("div"); wrap.className = "chat-attachment";
    const url = `/api/driver/chat/attachments/${attachment.id}/content`;
    if (attachment.kind === "IMAGE") {
      const link = document.createElement("a"); link.href = url; link.target = "_blank"; link.rel = "noreferrer";
      const image = document.createElement("img"); image.src = url; image.alt = attachment.fileName; image.loading = "lazy"; link.append(image); wrap.append(link);
    } else if (attachment.kind === "VIDEO") {
      const video = document.createElement("video"); video.src = url; video.controls = true; video.preload = "metadata"; video.playsInline = true; wrap.append(video);
    } else if (attachment.kind === "AUDIO") {
      const card = document.createElement("div"); card.className = "chat-audio-card";
      const icon = document.createElement("span"); icon.className = "chat-file-icon"; icon.textContent = "♪";
      const audio = document.createElement("audio"); audio.src = url; audio.controls = true; audio.preload = "metadata";
      const speed = document.createElement("button"); speed.type = "button"; speed.textContent = "1×"; speed.title = "Скорость";
      const speeds = [1, 1.5, 2]; let speedIndex = 0; speed.addEventListener("click", () => { speedIndex = (speedIndex + 1) % speeds.length; audio.playbackRate = speeds[speedIndex]; speed.textContent = `${speeds[speedIndex]}×`; });
      card.append(icon, audio, speed); wrap.append(card);
    } else {
      const link = document.createElement("a"); link.className = "chat-file-card"; link.href = url; link.download = attachment.fileName;
      const icon = document.createElement("span"); icon.className = "chat-file-icon"; icon.textContent = "▤";
      const copy = document.createElement("span"); copy.className = "chat-file-copy";
      const strong = document.createElement("strong"); strong.textContent = attachment.fileName;
      const small = document.createElement("small"); small.textContent = formatBytes(attachment.byteLength); copy.append(strong, small); link.append(icon, copy); wrap.append(link);
    }
    return wrap;
  }

  function renderPoll(message) {
    const poll = message.poll;
    const wrap = document.createElement("section"); wrap.className = "chat-poll";
    const title = document.createElement("h4"); title.textContent = poll.question; wrap.append(title);
    const total = poll.options.reduce((sum, option) => sum + option.votes, 0);
    for (const option of poll.options) {
      const button = document.createElement("button"); button.type = "button"; button.className = "chat-poll-option"; button.classList.toggle("voted", option.votedByMe); button.disabled = Boolean(poll.closedAt) || (poll.closesAt && Date.parse(poll.closesAt) <= Date.now());
      const mark = document.createElement("span"); mark.textContent = option.votedByMe ? "●" : "○";
      const text = document.createElement("span"); text.textContent = option.text;
      const count = document.createElement("strong"); count.textContent = `${option.votes}`;
      const bar = document.createElement("span"); bar.className = "chat-poll-bar"; const fill = document.createElement("span"); fill.style.width = `${total ? Math.round(option.votes / total * 100) : 0}%`; bar.append(fill);
      button.append(mark, text, count, bar); button.addEventListener("click", () => votePoll(message, option.id)); wrap.append(button);
    }
    const note = document.createElement("small"); note.style.color = "var(--muted)"; note.textContent = `${total} голосов${poll.closedAt ? " · завершён" : poll.multiple ? " · можно несколько" : ""}`; wrap.append(note);
    return wrap;
  }

  function receiptText(message) {
    const receipt = message.receipts;
    if (!receipt || receipt.total === 0) return { text: "✓", read: false, title: "Отправлено" };
    if (receipt.read > 0) return { text: "✓✓", read: true, title: receipt.total > 1 ? `Прочитали ${receipt.read}/${receipt.total}` : "Прочитано" };
    if (receipt.delivered > 0) return { text: "✓✓", read: false, title: receipt.total > 1 ? `Доставлено ${receipt.delivered}/${receipt.total}` : "Доставлено" };
    return { text: "✓", read: false, title: "Отправлено" };
  }

  function createReactionBar(message) {
    const bar = document.createElement("div"); bar.className = "chat-reactions";
    for (const reaction of message.reactions || []) {
      if (!reaction.count) continue;
      const view = reactionView(message.reactions, reaction.key);
      const node = document.createElement("button"); node.type = "button"; node.className = "chat-reaction"; node.setAttribute("aria-pressed", String(view.reactedByMe)); node.title = view.title; node.textContent = `${view.key} ${view.count}`; node.addEventListener("click", () => toggleReaction(message, view.key)); bar.append(node);
    }
    return bar;
  }

  function openMessageActions(message) {
    const actions = [];
    if (!message.deletedAt) {
      actions.push(ui.makeAction("Ответить", () => { replyMessage = message; editingMessage = null; ui.setComposerContext("reply", message); ui.closeDialog(); ui.input.focus(); }));
      actions.push(ui.makeAction("Копировать", async () => { try { await navigator.clipboard.writeText(message.text || ""); setState("Скопировано.", "active"); } catch { setState("Не удалось скопировать.", "error"); } ui.closeDialog(); }));
      actions.push(ui.makeAction("Переслать", () => { ui.closeDialog(); openForwardDialog(message); }));
      if (canEditLocally(message, ownNickname)) actions.push(ui.makeAction("Изменить", () => { editingMessage = message; replyMessage = null; ui.input.value = message.text || ""; ui.setComposerContext("edit", message); ui.closeDialog(); ui.input.focus(); }));
      if (room?.kind === "DIRECT" || room?.canModerate) actions.push(ui.makeAction("Закрепить", async () => { try { await api(`/api/driver/chat/rooms/${room.id}/pins/${message.id}`, { method: "POST", body: {} }); await loadPins(); } catch (error) { handleError(error, "Не удалось закрепить."); } ui.closeDialog(); }));
      const react = document.createElement("div"); react.className = "chat-dialog-actions";
      for (const option of CHAT_REACTIONS) { const node = ui.makeAction(option.key, () => { toggleReaction(message, option.key); ui.closeDialog(); }); node.title = option.label; react.append(node); }
      actions.push(react);
    }
    actions.push(ui.makeAction("Удалить у меня", async () => { await deleteMessage(message, "me"); ui.closeDialog(); }, { danger: true }));
    if (message.sender?.nickname === ownNickname || room?.canModerate) actions.push(ui.makeAction("Удалить у всех", async () => { if (window.confirm("Удалить сообщение у всех участников?")) await deleteMessage(message, "everyone"); ui.closeDialog(); }, { danger: true }));
    ui.showDialog("Сообщение", actions);
  }

  function renderMessages({ preserveScroll = false, scrollToBottom = true } = {}) {
    const wasNearBottom = isNearBottom(messagesElement);
    const previousTop = messagesElement.scrollTop, previousHeight = messagesElement.scrollHeight;
    messagesElement.replaceChildren();
    if (olderCursor !== null) { const older = document.createElement("button"); older.type = "button"; older.className = "chat-load-older"; older.textContent = "Загрузить раньше"; older.addEventListener("click", loadOlder); messagesElement.append(older); }
    let dayKey = "";
    for (const message of currentSortedMessages()) {
      const date = new Date(message.createdAt); const nextDay = date.toLocaleDateString();
      if (nextDay !== dayKey) { dayKey = nextDay; const separator = document.createElement("div"); separator.className = "chat-day-separator"; separator.textContent = nextDay; messagesElement.append(separator); }
      const own = message.sender?.nickname === ownNickname;
      const item = document.createElement("article"); item.className = "chat-message chat-bubble"; item.classList.toggle("own", own); item.classList.toggle("deleted", Boolean(message.deletedAt)); item.dataset.messageId = String(message.id);
      if (!own && room?.kind !== "DIRECT") { const author = document.createElement("strong"); author.className = "chat-message-author"; author.textContent = message.sender.nickname; item.append(author); }
      if (message.forwardedFrom && !message.deletedAt) { const forward = document.createElement("div"); forward.className = "chat-forward-label"; forward.textContent = `Переслано · ${message.forwardedFrom.sender}`; item.append(forward); }
      if (message.replyTo && !message.deletedAt) { const quote = document.createElement("div"); quote.className = "chat-reply-quote"; const strong = document.createElement("strong"); strong.textContent = message.replyTo.sender; const small = document.createElement("span"); small.textContent = message.replyTo.text || "Сообщение"; quote.append(strong, small); quote.addEventListener("click", () => scrollToMessage(message.replyTo.id)); item.append(quote); }
      if (message.deletedAt) { const body = document.createElement("p"); body.className = "chat-message-body"; body.textContent = "Сообщение удалено"; item.append(body); }
      else {
        if (message.attachments?.length) { const grid = document.createElement("div"); grid.className = "chat-attachment-grid"; for (const attachment of message.attachments) grid.append(createAttachmentNode(attachment)); item.append(grid); }
        if (message.poll) item.append(renderPoll(message));
        if (message.text) { const body = document.createElement("p"); body.className = "chat-message-body"; appendTextWithMentions(body, message.text); item.append(body); }
      }
      if (!message.deletedAt) item.append(createReactionBar(message));
      const footer = document.createElement("footer"); footer.className = "chat-message-footer";
      if (message.editedAt) { const edited = document.createElement("span"); edited.className = "edited"; edited.textContent = "изменено"; footer.append(edited); }
      const time = document.createElement("time"); time.dateTime = message.createdAt; time.textContent = date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); footer.append(time);
      if (own) { const receipt = receiptText(message); const mark = document.createElement("span"); mark.className = `chat-receipt${receipt.read ? " read" : ""}`; mark.textContent = receipt.text; mark.title = receipt.title; footer.append(mark); }
      item.append(footer);
      const menu = document.createElement("span"); menu.className = "chat-message-menu"; const more = document.createElement("button"); more.type = "button"; more.className = "chat-icon-button"; more.textContent = "⋮"; more.setAttribute("aria-label", "Действия"); more.addEventListener("click", () => openMessageActions(message)); menu.append(more); item.append(menu);
      messagesElement.append(item);
    }
    if (preserveScroll) messagesElement.scrollTop = previousTop + (messagesElement.scrollHeight - previousHeight);
    else if (scrollToBottom || wasNearBottom) messagesElement.scrollTop = messagesElement.scrollHeight;
  }

  function addMessages(items, options = {}) {
    let changed = false;
    for (const message of items || []) { const previous = messages.get(Number(message.id)); if (!previous || JSON.stringify(previous) !== JSON.stringify(message)) changed = true; messages.set(Number(message.id), message); }
    if (changed) renderMessages(options);
  }

  function renderRooms() { ui.renderRooms(Array.from(rooms.values()), { activeId: room?.id ?? null, onSelect: selectRoom }); }

  async function loadOverview({ silent = false } = {}) {
    try {
      const data = await api("/api/driver/chat/overview");
      rooms.clear(); for (const item of data.rooms || []) rooms.set(Number(item.id), item); currentInvites = data.invites || [];
      if (room) { const updated = rooms.get(Number(room.id)); if (updated) { room = updated; ui.setRoom(room); } else if (room.kind !== "GENERAL") { room = null; messages.clear(); ui.setRoom(null); renderMessages(); closeSocket(); } }
      renderRooms(); return data;
    } catch (error) { if (!silent) handleError(error, "Не удалось обновить список чатов."); return null; }
  }

  async function loadPins() {
    if (!room) return;
    try { const data = await api(`/api/driver/chat/rooms/${room.id}/pins`); ui.renderPins(data.pins || [], (message) => { if (!scrollToMessage(message.id)) { syncMessages().then(() => scrollToMessage(message.id)); } }); }
    catch { ui.renderPins([]); }
  }

  async function markRead() {
    if (!room || document.visibilityState !== "visible") return;
    const latest = currentSortedMessages().at(-1)?.id; if (!latest) return;
    try { await api(`/api/driver/chat/rooms/${room.id}/read`, { method: "POST", body: { messageId: latest } }); const currentRoom = rooms.get(room.id); if (currentRoom) { rooms.set(room.id, { ...currentRoom, unreadCount: 0, mentionCount: 0 }); renderRooms(); } }
    catch (error) { if (error.status === 401) onAuthLost(); }
  }

  async function selectRoom(nextRoom) {
    if (!nextRoom) return;
    if (room && Number(room.id) !== Number(nextRoom.id)) await saveDraftNow().catch(() => {});
    room = nextRoom; messages.clear(); olderCursor = null; replyMessage = null; editingMessage = null; pendingUploads = []; voiceReady = null; clearTyping(); closeSocket();
    ui.setRoom(room); ui.clearComposerContext(); ui.renderUploads([]); ui.input.value = room.draft?.text || ""; renderRooms(); renderMessages();
    if (!activated) return;
    await syncMessages(); await loadPins();
    if (room.draft?.replyToMessageId) { const target = messageById(room.draft.replyToMessageId); if (target) { replyMessage = target; ui.setComposerContext("reply", target); } }
    connectSocket(); markRead();
  }

  async function syncMessages(after = null) {
    if (!room) return;
    const suffix = after === null ? "?limit=100" : `?after=${after}&limit=100`;
    try {
      const data = await api(`/api/driver/chat/rooms/${room.id}/messages${suffix}`); addMessages(data.messages || []);
      if (after === null) { olderCursor = data.hasOlder ? data.previousCursor : null; renderMessages(); }
      setState(socket?.readyState === WebSocket.OPEN ? "В сети" : "История загружена", socket?.readyState === WebSocket.OPEN ? "active" : "offline");
      markRead();
    } catch (error) { handleError(error, "Не удалось загрузить сообщения."); }
  }

  async function loadOlder() {
    if (!room || olderCursor === null) return;
    try { const data = await api(`/api/driver/chat/rooms/${room.id}/messages?before=${olderCursor}&limit=100`); olderCursor = data.hasOlder ? data.previousCursor : null; addMessages(data.messages || [], { preserveScroll: true, scrollToBottom: false }); }
    catch (error) { handleError(error, "Не удалось загрузить ранние сообщения."); }
  }

  function closeSocket() {
    if (reconnectTimer) window.clearTimeout(reconnectTimer); reconnectTimer = null; const previous = socket; socket = null; if (previous) previous.close();
  }
  function scheduleReconnect() {
    if (!activated || !profileReady || !room || reconnectTimer) return; setState("Переподключаемся…", "offline"); reconnectTimer = window.setTimeout(() => { reconnectTimer = null; connectSocket(); }, RECONNECT_MS);
  }
  function connectSocket() {
    if (!room || !activated || !profileReady || socket?.readyState === WebSocket.OPEN || socket?.readyState === WebSocket.CONNECTING) return;
    const protocol = location.protocol === "https:" ? "wss:" : "ws:"; const current = new WebSocket(`${protocol}//${location.host}/api/driver/chat/socket`); socket = current;
    current.addEventListener("open", () => current.send(JSON.stringify({ type: "chat.subscribe", roomId: room.id })));
    current.addEventListener("message", async (event) => {
      let payload; try { payload = JSON.parse(event.data); } catch { return; }
      if (payload.roomId !== undefined && Number(payload.roomId) !== Number(room?.id)) return;
      if (payload.type === "chat.subscribed") { setState("В сети", "active"); const cursor = messages.size ? Math.max(...messages.keys()) : 0; await syncMessages(cursor); }
      else if (payload.type === "chat.message.committed") { addMessages([payload.message]); markRead(); loadOverview({ silent: true }); }
      else if (payload.type === "chat.message.updated") { addMessages([payload.message], { preserveScroll: true, scrollToBottom: false }); }
      else if (payload.type === "chat.message.deleted") { const currentMessage = messages.get(Number(payload.messageId)); if (currentMessage) { messages.set(Number(payload.messageId), { ...currentMessage, text: "", attachments: [], poll: null, reactions: [], deletedAt: new Date().toISOString() }); renderMessages({ preserveScroll: true, scrollToBottom: false }); } }
      else if (payload.type === "chat.reaction.updated") { const currentMessage = messages.get(Number(payload.messageId)); if (currentMessage) { const personalized = (payload.reactions || []).map((item) => ({ ...item, reactedByMe: Array.isArray(item.people) && item.people.includes(ownNickname) })); messages.set(Number(payload.messageId), { ...currentMessage, reactions: personalized }); renderMessages({ preserveScroll: true, scrollToBottom: false }); } }
      else if (payload.type === "chat.poll.updated") { const currentMessage = messages.get(Number(payload.messageId)); if (currentMessage) { messages.set(Number(payload.messageId), { ...currentMessage, poll: payload.poll }); renderMessages({ preserveScroll: true, scrollToBottom: false }); } }
      else if (payload.type === "chat.pins.updated") loadPins();
      else if (payload.type === "chat.receipt.updated") syncMessages(messages.size ? Math.max(0, Math.min(...messages.keys()) - 1) : null);
      else if (payload.type === "chat.typing") { ui.setTyping(`${payload.nickname} печатает…`); if (typingTimer) window.clearTimeout(typingTimer); typingTimer = window.setTimeout(() => { ui.setTyping(""); typingTimer = null; }, 1800); }
      else if (payload.type === "chat.room.updated" || payload.type === "chat.members.updated") loadOverview({ silent: true });
      else if (payload.type === "chat.error" && ["driver_blocked", "chat_room_banned"].includes(payload.error)) handleBlockedRoom();
    });
    current.addEventListener("close", () => { if (socket === current) scheduleReconnect(); }); current.addEventListener("error", () => current.close());
  }

  function handleBlockedRoom() {
    if (!room) return; rooms.delete(room.id); room = null; messages.clear(); olderCursor = null; closeSocket(); ui.setRoom(null); renderRooms(); renderMessages(); setState("Этот чат больше недоступен.", "error");
  }

  async function toggleReaction(message, reaction) {
    try { const data = await api(`/api/driver/chat/messages/${message.id}/reactions`, { method: "POST", body: { reaction } }); const current = messages.get(message.id); if (current) { messages.set(message.id, { ...current, reactions: data.reactions || [] }); renderMessages({ preserveScroll: true, scrollToBottom: false }); } }
    catch (error) { handleError(error, "Не удалось изменить реакцию."); }
  }

  async function deleteMessage(message, scope) {
    try { await api(`/api/driver/chat/messages/${message.id}`, { method: "DELETE", body: { scope } }); if (scope === "me") messages.delete(message.id); else messages.set(message.id, { ...message, text: "", attachments: [], poll: null, reactions: [], deletedAt: new Date().toISOString() }); renderMessages({ preserveScroll: true, scrollToBottom: false }); await loadOverview({ silent: true }); }
    catch (error) { handleError(error, "Не удалось удалить сообщение."); }
  }

  async function votePoll(message, optionId) {
    try { const existing = message.poll?.options?.filter((option) => option.votedByMe).map((option) => option.id) || []; let optionIds; if (message.poll.multiple) optionIds = existing.includes(optionId) ? existing.filter((id) => id !== optionId) : [...existing, optionId]; else optionIds = [optionId]; if (!optionIds.length && message.poll.multiple) optionIds = [optionId]; const data = await api(`/api/driver/chat/polls/${message.id}/vote`, { method: "POST", body: { optionIds } }); messages.set(message.id, { ...message, poll: data.poll }); renderMessages({ preserveScroll: true, scrollToBottom: false }); }
    catch (error) { handleError(error, "Не удалось проголосовать."); }
  }

  async function prepareUpload(file, { kind = attachmentKind(file), durationMs = null, fileName = file.name } = {}) {
    if (!room) throw new Error("chat_room_not_found");
    const prepared = await api("/api/driver/chat/uploads", { method: "POST", body: { roomId: room.id, kind, fileName, mimeType: file.type || "application/octet-stream", byteLength: file.size, durationMs } });
    await uploadBinary(prepared.uploadUrl, file, { headers: { "X-Chat-Upload-Token": prepared.uploadToken }, timeoutMs: 120_000 });
    return { ...prepared.upload, id: prepared.upload.id, kind, fileName, mimeType: file.type, byteLength: file.size, durationMs };
  }

  async function attachFiles(files) {
    const list = Array.from(files || []);
    if (!list.length || !room) return;
    if (pendingUploads.length + list.length > MAX_PENDING_ATTACHMENTS) return setState(`Не больше ${MAX_PENDING_ATTACHMENTS} вложений в сообщении.`, "error");
    setState("Загружаем вложения…");
    for (const file of list) {
      try { const upload = await prepareUpload(file); pendingUploads.push(upload); ui.renderUploads(pendingUploads, removePendingUpload); }
      catch (error) { handleError(error, `Не удалось загрузить ${file.name || "файл"}.`); }
    }
    setState("Вложения готовы.", "active");
  }

  async function removePendingUpload(upload) {
    pendingUploads = pendingUploads.filter((item) => item.id !== upload.id); ui.renderUploads(pendingUploads, removePendingUpload); try { await api(`/api/driver/chat/uploads/${upload.id}`, { method: "DELETE", body: {} }); } catch {}
  }

  async function submitMessage() {
    if (!room) return;
    const text = ui.input.value.trim();
    if (editingMessage) {
      if (!text) return;
      try { const data = await api(`/api/driver/chat/messages/${editingMessage.id}`, { method: "PATCH", body: { text } }); messages.set(data.message.id, { ...data.message, reactions: messages.get(data.message.id)?.reactions || [] }); editingMessage = null; ui.input.value = ""; ui.clearComposerContext(); renderMessages({ preserveScroll: true, scrollToBottom: false }); }
      catch (error) { handleError(error, "Не удалось изменить сообщение."); }
      return;
    }
    if (!text && !pendingUploads.length && !voiceReady) return;
    const uploads = [...pendingUploads]; if (voiceReady) uploads.push(voiceReady);
    const body = { clientMessageId: randomId(), text, uploadIds: uploads.map((item) => item.id), replyToMessageId: replyMessage?.id ?? null };
    const send = form.querySelector('button[type="submit"]'); send.disabled = true;
    try { const data = await api(`/api/driver/chat/rooms/${room.id}/messages`, { method: "POST", body }); addMessages([data.message]); ui.input.value = ""; replyMessage = null; pendingUploads = []; voiceReady = null; ui.clearComposerContext(); ui.renderUploads([]); ui.setVoice(false); await saveDraftNow(); await loadOverview({ silent: true }); }
    catch (error) { handleError(error, "Сообщение не отправлено. Текст и вложения оставлены в редакторе."); }
    finally { send.disabled = false; }
  }

  async function saveDraftNow() {
    if (!room || editingMessage) return;
    if (draftTimer) window.clearTimeout(draftTimer); draftTimer = null;
    try { await api(`/api/driver/chat/rooms/${room.id}/draft`, { method: "PUT", body: { text: ui.input.value, replyToMessageId: replyMessage?.id ?? null } }); const current = rooms.get(room.id); if (current) { rooms.set(room.id, { ...current, draft: ui.input.value || replyMessage ? { text: ui.input.value, replyToMessageId: replyMessage?.id ?? null } : null }); renderRooms(); } }
    catch (error) { if (error.status === 401) onAuthLost(); }
  }
  function scheduleDraft() { if (draftTimer) window.clearTimeout(draftTimer); draftTimer = window.setTimeout(saveDraftNow, DRAFT_SAVE_MS); }

  function openForwardDialog(message) {
    const rows = Array.from(rooms.values()).filter((target) => !target.archived).map((target) => ui.makeRow({ title: target.title, subtitle: target.kind, actions: [ui.makeAction("Переслать", async () => { try { const data = await api(`/api/driver/chat/rooms/${target.id}/messages`, { method: "POST", body: { clientMessageId: randomId("fwd"), text: "", forwardFromMessageId: message.id } }); setState(`Переслано в «${target.title}».`, "active"); ui.closeDialog(); if (Number(target.id) === Number(room?.id)) addMessages([data.message]); } catch (error) { handleError(error, "Не удалось переслать сообщение."); } })] }));
    ui.showDialog("Переслать в…", rows);
  }

  function openSearchDialog() {
    const wrap = document.createElement("div"); wrap.className = "chat-form-stack";
    const input = document.createElement("input"); input.type = "search"; input.placeholder = "Текст, файл или ссылка";
    const results = document.createElement("div"); results.className = "chat-form-stack"; wrap.append(input, results);
    let timer = null; input.addEventListener("input", () => { if (timer) window.clearTimeout(timer); timer = window.setTimeout(async () => { const q = input.value.trim(); results.replaceChildren(); if (q.length < 2) return; try { const data = await api(`/api/driver/chat/search?q=${encodeURIComponent(q)}&roomId=${room.id}&limit=50`); for (const message of data.messages || []) { const text = message.text || message.poll?.question || message.attachments?.[0]?.fileName || "Сообщение"; const row = ui.makeRow({ title: message.sender.nickname, subtitle: text, actions: [ui.makeAction("Открыть", () => { messages.set(message.id, message); renderMessages({ scrollToBottom: false }); ui.closeDialog(); scrollToMessage(message.id); })] }); row.classList.add("chat-search-result"); results.append(row); } if (!results.children.length) results.textContent = "Ничего не найдено."; } catch { results.textContent = "Поиск временно недоступен."; } }, 250); });
    ui.showDialog("Поиск в чате", wrap); input.focus();
  }

  function openNewDirect() {
    const formNode = ui.makeForm([{ name: "nickname", label: "Никнейм водителя", required: true, minLength: 3, maxLength: 32 }], "Открыть чат", async ({ nickname }) => { try { await openDirect(nickname); return true; } catch { return false; } });
    ui.showDialog("Новый личный чат", formNode);
  }

  function openNewGroup() {
    const formNode = ui.makeForm([
      { name: "title", label: "Название", required: true, minLength: 3, maxLength: 64 },
      { name: "description", label: "Описание", type: "textarea", maxLength: 500 },
      { name: "visibility", label: "Доступ", type: "select", options: [["PRIVATE","Закрытая"],["PUBLIC","Открытая"]] },
      { name: "historyPolicy", label: "История для новых участников", type: "select", options: [["FULL","Вся история"],["JOINED","Только после вступления"]] }
    ], "Создать", async (values) => { try { const data = await api("/api/driver/chat/groups", { method: "POST", body: values }); await loadOverview(); await selectRoom(data.room); return true; } catch (error) { handleError(error, "Не удалось создать группу."); return false; } });
    ui.showDialog("Новая группа", formNode);
  }

  function openPollDialog() {
    const formNode = ui.makeForm([
      { name: "question", label: "Вопрос", required: true, maxLength: 300 },
      { name: "options", label: "Варианты — каждый с новой строки", type: "textarea", required: true, maxLength: 1200 },
      { name: "multiple", label: "Выбор", type: "select", options: [["0","Один вариант"],["1","Несколько вариантов"]] }
    ], "Создать опрос", async (values) => { const options = values.options.split("\n").map((value) => value.trim()).filter(Boolean); try { const data = await api(`/api/driver/chat/rooms/${room.id}/polls`, { method: "POST", body: { clientMessageId: randomId("poll"), question: values.question, options, multiple: values.multiple === "1" } }); addMessages([data.message]); return true; } catch (error) { handleError(error, "Не удалось создать опрос."); return false; } });
    ui.showDialog("Опрос", formNode);
  }

  async function openDiscoverGroups() {
    const wrap = document.createElement("div"); wrap.className = "chat-form-stack"; const input = document.createElement("input"); input.placeholder = "Поиск открытых групп"; const results = document.createElement("div"); results.className = "chat-form-stack"; wrap.append(input, results);
    const search = async () => { try { const data = await api(`/api/driver/chat/groups/discover?q=${encodeURIComponent(input.value.trim())}`); results.replaceChildren(); for (const group of data.groups || []) results.append(ui.makeRow({ title: group.title, subtitle: `${group.memberCount} участников · ${group.description || "Открытая группа"}`, actions: group.joined ? [] : [ui.makeAction("Вступить", async () => { await api(`/api/driver/chat/groups/${group.id}/join`, { method: "POST", body: {} }); await loadOverview(); await search(); })] })); if (!results.children.length) results.textContent = "Группы не найдены."; } catch { results.textContent = "Поиск групп недоступен."; } };
    input.addEventListener("input", () => { clearTimeout(input._timer); input._timer = setTimeout(search, 250); }); ui.showDialog("Найти группу", wrap); search();
  }

  function openInvites() {
    const rows = currentInvites.map((invite) => ui.makeRow({ title: invite.title, subtitle: `${invite.invitedBy} · ${invite.memberCount} участников`, actions: [
      ui.makeAction("Принять", async () => { await api(`/api/driver/chat/invites/${invite.roomId}/respond`, { method: "POST", body: { action: "ACCEPT" } }); await loadOverview(); openInvites(); }),
      ui.makeAction("Отклонить", async () => { await api(`/api/driver/chat/invites/${invite.roomId}/respond`, { method: "POST", body: { action: "DECLINE" } }); await loadOverview(); openInvites(); })
    ] }));
    ui.showDialog("Приглашения", rows.length ? rows : [document.createTextNode("Новых приглашений нет.")]);
  }

  async function openRoomInfo() {
    if (!room) return;
    try {
      const data = await api(`/api/driver/chat/rooms/${room.id}`); room = data.room; rooms.set(room.id, room); ui.setRoom(room);
      const content = document.createElement("div"); content.className = "chat-form-stack";
      content.append(ui.makeRow({ title: room.title, subtitle: `${room.kind}${room.description ? ` · ${room.description}` : ""}`, actions: [] }));
      const preferenceActions = [
        ui.makeAction(room.favorite ? "★ Избранное" : "☆ В избранное", async () => { await updatePreferences({ favorite: !room.favorite }); ui.closeDialog(); }),
        ui.makeAction(room.muted ? "Включить уведомления" : "Без уведомлений", async () => { await updatePreferences({ muted: !room.muted }); ui.closeDialog(); }),
        ui.makeAction(room.archived ? "Вернуть из архива" : "В архив", async () => { await updatePreferences({ archived: !room.archived }); ui.closeDialog(); }),
        ui.makeAction(room.pinnedRank === null ? "Закрепить чат" : "Открепить чат", async () => { await updatePreferences({ pinnedRank: room.pinnedRank === null ? 0 : null }); ui.closeDialog(); })
      ];
      content.append(ui.makeRow({ title: "Чат", subtitle: room.notificationLevel === "MENTIONS" ? "Только упоминания" : room.notificationLevel === "NONE" ? "Уведомления выключены" : "Все уведомления", actions: preferenceActions }));
      if (room.kind === "GROUP") {
        for (const member of data.members || []) {
          const actions = [];
          if (room.canManage && member.nickname !== ownNickname) actions.push(ui.makeSelect([["ADMIN","Админ"],["MODERATOR","Модератор"],["MEMBER","Участник"],["READONLY","Только чтение"]], member.role === "OWNER" ? "ADMIN" : member.role, async (role) => { try { await api(`/api/driver/chat/groups/${room.id}/members/${encodeURIComponent(member.nickname)}`, { method: "PATCH", body: { role } }); } catch (error) { handleError(error, "Не удалось изменить роль."); } }));
          if (room.canModerate && member.nickname !== ownNickname && member.role !== "OWNER") actions.push(ui.makeAction("Удалить", async () => { await api(`/api/driver/chat/groups/${room.id}/members/${encodeURIComponent(member.nickname)}`, { method: "DELETE", body: { ban: false } }); await openRoomInfo(); }, { danger: true }));
          content.append(ui.makeRow({ title: member.nickname, subtitle: `${member.driverType} · ${member.role}`, actions }));
        }
        if (room.canModerate) content.append(ui.makeRow({ title: "Управление группой", subtitle: `${room.visibility === "PUBLIC" ? "Открытая" : "Закрытая"} · ${room.historyPolicy}`, actions: [ui.makeAction("Пригласить", () => openInviteMember()), ...(room.canManage ? [ui.makeAction("Изменить", () => openEditGroup())] : [])] }));
        if (room.role !== "OWNER") content.append(ui.makeRow({ title: "Покинуть группу", actions: [ui.makeAction("Выйти", async () => { if (!confirm("Покинуть группу?")) return; await api(`/api/driver/chat/groups/${room.id}/leave`, { method: "POST", body: {} }); ui.closeDialog(); room = null; await loadOverview(); ui.setRoom(null); }, { danger: true })] }));
        if (room.role === "OWNER") content.append(ui.makeRow({ title: "Удалить группу", subtitle: "Удалится сама группа и её история", actions: [ui.makeAction("Удалить", async () => { if (!confirm("Удалить группу полностью?")) return; await api(`/api/driver/chat/rooms/${room.id}`, { method: "DELETE", body: {} }); ui.closeDialog(); room = null; await loadOverview(); ui.setRoom(null); }, { danger: true })] }));
      }
      ui.showDialog("Информация о чате", content);
    } catch (error) { handleError(error, "Не удалось открыть информацию о чате."); }
  }

  function openInviteMember() {
    const formNode = ui.makeForm([{ name: "nickname", label: "Никнейм контакта", required: true, maxLength: 32 }], "Пригласить", async ({ nickname }) => { try { await api(`/api/driver/chat/groups/${room.id}/invites`, { method: "POST", body: { nickname } }); setState("Приглашение отправлено.", "active"); return true; } catch (error) { handleError(error, "Не удалось пригласить. Для закрытых групп нужен подтверждённый контакт."); return false; } }); ui.showDialog("Пригласить в группу", formNode);
  }
  function openEditGroup() {
    const formNode = ui.makeForm([
      { name: "title", label: "Название", required: true, value: room.title, maxLength: 64 }, { name: "description", label: "Описание", type: "textarea", value: room.description, maxLength: 500 },
      { name: "visibility", label: "Доступ", type: "select", value: room.visibility, options: [["PRIVATE","Закрытая"],["PUBLIC","Открытая"]] }, { name: "historyPolicy", label: "История новых участников", type: "select", value: room.historyPolicy, options: [["FULL","Вся история"],["JOINED","После вступления"]] }
    ], "Сохранить", async (values) => { try { const data = await api(`/api/driver/chat/rooms/${room.id}`, { method: "PATCH", body: values }); room = data.room; rooms.set(room.id, room); ui.setRoom(room); renderRooms(); return true; } catch (error) { handleError(error, "Не удалось изменить группу."); return false; } }); ui.showDialog("Настройки группы", formNode);
  }

  async function updatePreferences(patch) {
    try { const data = await api(`/api/driver/chat/rooms/${room.id}/preferences`, { method: "PATCH", body: patch }); room = { ...room, ...data.preferences }; rooms.set(room.id, room); ui.setRoom(room); renderRooms(); }
    catch (error) { handleError(error, "Не удалось изменить настройки чата."); }
  }

  function openMoreMenu() {
    const content = document.createElement("div"); content.className = "chat-form-stack";
    content.append(ui.makeRow({ title: "Группы", subtitle: "Найти открытые сообщества водителей", actions: [ui.makeAction("Найти", () => { ui.closeDialog(); openDiscoverGroups(); })] }));
    content.append(ui.makeRow({ title: "Приглашения", subtitle: currentInvites.length ? `${currentInvites.length} новых` : "Новых нет", actions: [ui.makeAction("Открыть", () => { ui.closeDialog(); openInvites(); })] }));
    ui.showDialog("Чаты", content);
  }

  function openAttachmentMenu() {
    const photoInput = document.createElement("input"); photoInput.type = "file"; photoInput.accept = "image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm,video/quicktime"; photoInput.multiple = true; photoInput.hidden = true;
    const fileInput = document.createElement("input"); fileInput.type = "file"; fileInput.multiple = true; fileInput.hidden = true;
    photoInput.addEventListener("change", () => { ui.closeDialog(); attachFiles(photoInput.files); }); fileInput.addEventListener("change", () => { ui.closeDialog(); attachFiles(fileInput.files); }); document.body.append(photoInput, fileInput);
    const actions = [
      ui.makeRow({ title: "Фото или видео", actions: [ui.makeAction("Выбрать", () => photoInput.click())] }),
      ui.makeRow({ title: "Файл", subtitle: "PDF, документы, архивы, текст", actions: [ui.makeAction("Выбрать", () => fileInput.click())] }),
      ui.makeRow({ title: "Опрос", subtitle: "До 12 вариантов", actions: [ui.makeAction("Создать", () => { ui.closeDialog(); openPollDialog(); })] })
    ];
    ui.showDialog("Добавить", actions);
  }

  async function startVoice() {
    if (!room || voiceRecorder.isActive()) return;
    try { await voiceRecorder.start(); }
    catch { setState("Не удалось включить микрофон для голосового сообщения.", "error"); }
  }
  async function finishVoice() {
    try { const result = await voiceRecorder.stop(); if (!result?.blob?.size) return; const file = new File([result.blob], result.fileName, { type: result.blob.type }); setState("Загружаем голосовое…"); voiceReady = await prepareUpload(file, { kind: "AUDIO", durationMs: result.durationMs, fileName: result.fileName }); ui.renderUploads([...pendingUploads, voiceReady], (upload) => upload.id === voiceReady?.id ? removeVoiceReady() : removePendingUpload(upload)); setState("Голосовое готово к отправке.", "active"); }
    catch (error) { handleError(error, "Не удалось подготовить голосовое сообщение."); }
  }
  async function removeVoiceReady() { if (!voiceReady) return; const current = voiceReady; voiceReady = null; ui.renderUploads(pendingUploads, removePendingUpload); try { await api(`/api/driver/chat/uploads/${current.id}`, { method: "DELETE", body: {} }); } catch {} }

  async function activate() {
    activated = true;
    if (!profileReady) return setState("Сначала сохраните профиль водителя.", "error");
    const data = await loadOverview(); if (!data) return;
    if (!overviewTimer) overviewTimer = window.setInterval(() => loadOverview({ silent: true }), OVERVIEW_POLL_MS);
    if (!room) { const initial = (data.rooms || []).find((item) => !item.archived && item.unreadCount) || (data.rooms || []).find((item) => item.key === "general") || (data.rooms || []).find((item) => !item.archived); if (initial && window.innerWidth > 820) await selectRoom(initial); else { ui.setRoom(null); renderRooms(); setState("Чаты готовы.", "active"); } }
    else { await syncMessages(); connectSocket(); }
  }

  form.addEventListener("submit", (event) => { event.preventDefault(); submitMessage(); });
  ui.input.addEventListener("keydown", (event) => { if (event.key === "Enter" && !event.shiftKey && !event.isComposing) { event.preventDefault(); submitMessage(); } });
  ui.input.addEventListener("input", () => { scheduleDraft(); const now = Date.now(); if (room && socket?.readyState === WebSocket.OPEN && now - lastTypingSentAt >= 1200) { lastTypingSentAt = now; socket.send(JSON.stringify({ type: "chat.typing", roomId: room.id })); } ui.input.style.height = "auto"; ui.input.style.height = `${Math.min(132, ui.input.scrollHeight)}px`; });
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") markRead(); });
  messagesElement.addEventListener("scroll", () => { if (isNearBottom(messagesElement)) markRead(); });
  ui.controls.contextClose.addEventListener("click", () => { replyMessage = null; editingMessage = null; ui.clearComposerContext(); scheduleDraft(); });
  ui.controls.newDirectButton.addEventListener("click", openNewDirect); ui.controls.newGroupButton.addEventListener("click", openNewGroup); ui.controls.menuButton.addEventListener("click", openMoreMenu);
  ui.controls.searchButton.addEventListener("click", openSearchDialog); ui.controls.roomInfoButton.addEventListener("click", openRoomInfo); ui.controls.attachmentButton.addEventListener("click", openAttachmentMenu);
  ui.controls.voiceButton.addEventListener("click", startVoice); ui.controls.voicePause.addEventListener("click", () => voiceRecorder.isPaused() ? voiceRecorder.resume() : voiceRecorder.pause()); ui.controls.voiceCancel.addEventListener("click", () => voiceRecorder.cancel()); ui.controls.voiceDone.addEventListener("click", finishVoice);

  async function openDirect(nickname) {
    if (!profileReady) { setState("Сначала сохраните профиль водителя.", "error"); throw new Error("driver_profile_required"); }
    try { const data = await api("/api/driver/chat/direct", { method: "POST", body: { nickname } }); await loadOverview({ silent: true }); rooms.set(Number(data.room.id), data.room); await selectRoom(data.room); return data.room; }
    catch (error) { handleError(error, error.message === "driver_not_found" ? "Водитель больше недоступен." : "Не удалось открыть личный чат."); throw error; }
  }

  return {
    activate, openDirect,
    setSession({ profile }) { profileReady = Boolean(profile); ownNickname = profile?.nickname || ""; navButton.disabled = !profileReady; navButton.title = profileReady ? "" : "Сначала сохраните профиль"; },
    setProfileReady(value) { profileReady = Boolean(value); ownNickname = value?.nickname || ownNickname; navButton.disabled = !profileReady; },
    async reset() {
      activated = false; profileReady = false; ownNickname = ""; room = null; rooms.clear(); messages.clear(); olderCursor = null; clearTyping(); closeSocket();
      if (overviewTimer) window.clearInterval(overviewTimer); overviewTimer = null; if (draftTimer) window.clearTimeout(draftTimer); draftTimer = null;
      await voiceRecorder.cancel().catch(() => {}); pendingUploads = []; voiceReady = null; replyMessage = null; editingMessage = null; ui.setRoom(null); ui.renderRooms([]); ui.renderPins([]); ui.renderUploads([]); renderMessages(); navButton.disabled = true; setState("Чат отключён");
    }
  };
}

export function createDriverModule(context) {
  const controller = createChatController({ api: context.api, uploadBinary: context.uploadBinary, onAuthLost: context.onAuthLost });
  return {
    controller,
    setSession({ profile }) { controller.setSession({ profile }); },
    setProfileReady(profile) { controller.setProfileReady(profile); },
    activate() { return controller.activate(); },
    openDirect(nickname) { return controller.openDirect(nickname); },
    reset() { return controller.reset(); }
  };
}
