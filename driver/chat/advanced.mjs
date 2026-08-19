const EXPIRY_KEY = "patap_chat_expiry_v1";
const EXPIRY_OPTIONS = Object.freeze([
  { seconds: 0, label: "Выкл" },
  { seconds: 3600, label: "1 час" },
  { seconds: 86400, label: "24 часа" },
  { seconds: 604800, label: "7 дней" },
  { seconds: 2592000, label: "30 дней" }
]);
const NOTIFICATION_OPTIONS = Object.freeze([
  ["ALL", "Все сообщения"],
  ["MENTIONS", "Только упоминания @"],
  ["NONE", "Без уведомлений"]
]);

function readExpiryMap() {
  try {
    const parsed = JSON.parse(localStorage.getItem(EXPIRY_KEY) || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeExpiryMap(value) {
  try { localStorage.setItem(EXPIRY_KEY, JSON.stringify(value)); } catch {}
}

function button(text, label = text) {
  const node = document.createElement("button");
  node.type = "button";
  node.className = "chat-icon-button";
  node.textContent = text;
  node.setAttribute("aria-label", label);
  node.title = label;
  return node;
}

function makeDialog(titleText) {
  const dialog = document.createElement("dialog");
  dialog.className = "chat-dialog";
  const head = document.createElement("div"); head.className = "chat-dialog-head";
  const title = document.createElement("h3"); title.textContent = titleText;
  const close = button("×", "Закрыть"); head.append(title, close);
  const body = document.createElement("div"); body.className = "chat-dialog-body";
  dialog.append(head, body); document.body.append(dialog);
  close.addEventListener("click", () => dialog.close());
  dialog.addEventListener("click", (event) => { if (event.target === dialog) dialog.close(); });
  return { dialog, body, destroy: () => dialog.remove() };
}

function row(title, subtitle = "") {
  const item = document.createElement("div"); item.className = "chat-dialog-row";
  const copy = document.createElement("div"); const strong = document.createElement("strong"); strong.textContent = title; copy.append(strong);
  if (subtitle) { const small = document.createElement("small"); small.textContent = subtitle; copy.append(small); }
  const actions = document.createElement("div"); actions.className = "chat-dialog-actions"; item.append(copy, actions);
  return { item, actions };
}

export function createChatAdvanced({ card, api, openDirectRadio, showError = () => {} } = {}) {
  if (!card) return { expirySeconds: () => 0, destroy() {} };
  const headActions = card.querySelector(".chat-head-actions");
  if (!headActions) return { expirySeconds: () => 0, destroy() {} };

  const expiryButton = button("⏱", "Исчезающие сообщения");
  const notifyButton = button("🔔", "Уведомления этого чата");
  const radioButton = button("◉", "Открыть рацию с этим водителем");
  const ownerButton = button("♛", "Передать владение группой");
  headActions.prepend(radioButton, expiryButton, notifyButton, ownerButton);

  let currentRoom = null;
  let expiryMap = readExpiryMap();
  const dialogs = [];

  function expirySeconds(roomId = currentRoom?.id) {
    const value = Number(expiryMap[String(roomId)] || 0);
    return EXPIRY_OPTIONS.some((item) => item.seconds === value) ? value : 0;
  }

  function updateButtons() {
    const room = currentRoom;
    const expiry = EXPIRY_OPTIONS.find((item) => item.seconds === expirySeconds()) || EXPIRY_OPTIONS[0];
    expiryButton.disabled = !room || (room.kind === "GROUP" && room.role === "READONLY");
    expiryButton.title = room ? `Исчезающие сообщения: ${expiry.label}` : "Исчезающие сообщения";
    expiryButton.textContent = expiry.seconds ? "⏳" : "⏱";
    notifyButton.disabled = !room;
    notifyButton.textContent = room?.notificationLevel === "NONE" ? "🔕" : room?.notificationLevel === "MENTIONS" ? "@" : "🔔";
    radioButton.hidden = !room || room.kind !== "DIRECT" || !room.peer?.nickname || typeof openDirectRadio !== "function";
    ownerButton.hidden = !room || room.kind !== "GROUP" || room.role !== "OWNER";
  }

  function openExpiryDialog() {
    if (!currentRoom) return;
    const ui = makeDialog("Исчезающие сообщения"); dialogs.push(ui);
    const intro = document.createElement("p"); intro.className = "help";
    intro.textContent = "Таймер применяется только к вашим новым сообщениям в этом чате. Уже отправленные сообщения не меняются.";
    ui.body.append(intro);
    for (const option of EXPIRY_OPTIONS) {
      const item = row(option.label, option.seconds ? "Сообщение будет удалено после указанного срока." : "Новые сообщения будут храниться без таймера.");
      const choose = document.createElement("button"); choose.type = "button"; choose.textContent = expirySeconds() === option.seconds ? "Выбрано" : "Выбрать"; choose.disabled = expirySeconds() === option.seconds;
      choose.addEventListener("click", () => {
        expiryMap[String(currentRoom.id)] = option.seconds;
        writeExpiryMap(expiryMap);
        updateButtons(); ui.dialog.close();
        showError(option.seconds ? `Таймер новых сообщений: ${option.label}.` : "Таймер исчезновения выключен.");
      });
      item.actions.append(choose); ui.body.append(item.item);
    }
    ui.dialog.showModal();
  }

  function openNotificationDialog() {
    if (!currentRoom) return;
    const ui = makeDialog("Уведомления"); dialogs.push(ui);
    for (const [value, label] of NOTIFICATION_OPTIONS) {
      const item = row(label, value === "MENTIONS" ? "Уведомлять только при прямом @упоминании или @all." : value === "NONE" ? "Новые сообщения не будут поднимать уведомления." : "Обычный режим уведомлений.");
      const choose = document.createElement("button"); choose.type = "button"; choose.textContent = currentRoom.notificationLevel === value ? "Выбрано" : "Выбрать"; choose.disabled = currentRoom.notificationLevel === value;
      choose.addEventListener("click", async () => {
        try {
          await api(`/api/driver/chat/rooms/${currentRoom.id}/preferences`, { method: "PATCH", body: { notificationLevel: value, muted: value === "NONE" } });
          currentRoom = { ...currentRoom, notificationLevel: value, muted: value === "NONE" };
          updateButtons(); ui.dialog.close(); showError(`Уведомления: ${label}.`);
        } catch { showError("Не удалось изменить уведомления."); }
      });
      item.actions.append(choose); ui.body.append(item.item);
    }
    ui.dialog.showModal();
  }

  async function openOwnerTransferDialog() {
    if (!currentRoom || currentRoom.kind !== "GROUP" || currentRoom.role !== "OWNER") return;
    const ui = makeDialog("Передать владение"); dialogs.push(ui);
    const warning = document.createElement("p"); warning.className = "help"; warning.textContent = "Новый владелец получит полный контроль над группой. Вы станете администратором."; ui.body.append(warning);
    try {
      const details = await api(`/api/driver/chat/rooms/${currentRoom.id}`);
      const candidates = (details.members || []).filter((member) => member.role !== "OWNER");
      if (!candidates.length) { ui.body.append(document.createTextNode("Нет другого участника, которому можно передать группу.")); }
      for (const member of candidates) {
        const item = row(member.nickname, `${member.driverType} · ${member.role}`);
        const transfer = document.createElement("button"); transfer.type = "button"; transfer.textContent = "Передать";
        transfer.addEventListener("click", async () => {
          if (!confirm(`Передать группу «${currentRoom.title}» пользователю ${member.nickname}?`)) return;
          try {
            await api(`/api/driver/chat/groups/${currentRoom.id}/members/${encodeURIComponent(member.nickname)}`, { method: "PATCH", body: { role: "OWNER" } });
            currentRoom = { ...currentRoom, role: "ADMIN", canManage: true, canModerate: true };
            updateButtons(); ui.dialog.close(); showError(`Владение группой передано: ${member.nickname}.`);
          } catch { showError("Не удалось передать владение группой."); }
        });
        item.actions.append(transfer); ui.body.append(item.item);
      }
    } catch { ui.body.append(document.createTextNode("Не удалось загрузить участников группы.")); }
    ui.dialog.showModal();
  }

  function onRoomChanged(event) {
    currentRoom = event.detail?.room || null;
    updateButtons();
  }

  card.addEventListener("patap:chat-room-changed", onRoomChanged);
  expiryButton.addEventListener("click", openExpiryDialog);
  notifyButton.addEventListener("click", openNotificationDialog);
  radioButton.addEventListener("click", () => {
    if (currentRoom?.peer?.nickname && typeof openDirectRadio === "function") {
      Promise.resolve(openDirectRadio(currentRoom.peer.nickname)).catch(() => showError("Не удалось открыть рацию."));
    }
  });
  ownerButton.addEventListener("click", openOwnerTransferDialog);
  updateButtons();

  return {
    expirySeconds,
    destroy() {
      card.removeEventListener("patap:chat-room-changed", onRoomChanged);
      for (const node of [expiryButton, notifyButton, radioButton, ownerButton]) node.remove();
      for (const ui of dialogs) ui.destroy();
    }
  };
}

export const CHAT_EXPIRY_OPTIONS = EXPIRY_OPTIONS;
export const CHAT_NOTIFICATION_OPTIONS = NOTIFICATION_OPTIONS;
