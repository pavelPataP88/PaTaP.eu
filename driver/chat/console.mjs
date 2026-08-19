import {
  createChatConsoleUi as createBaseChatConsoleUi,
  installChatConsoleStyles,
  CHAT_ROOM_KIND_LABELS,
  CHAT_ROLE_LABELS
} from "./console-v2.mjs";

function installPolicyStyles() {
  if (document.getElementById("patap-chat-console-v2-policy")) return;
  const style = document.createElement("style");
  style.id = "patap-chat-console-v2-policy";
  style.textContent = `
    .chat-card.chat-console-card{position:relative}
    .chat-card.chat-console-card[data-chat-readonly="true"] .chat-console-form{opacity:.58}
    .chat-card.chat-console-card[data-chat-readonly="true"] .chat-console-form textarea{cursor:not-allowed}
  `;
  document.head.append(style);
}

export function createChatConsoleUi(args) {
  installPolicyStyles();
  const ui = createBaseChatConsoleUi(args);
  const originalSetRoom = ui.setRoom.bind(ui);

  ui.setRoom = (room) => {
    originalSetRoom(room);
    const readOnly = room?.kind === "GROUP" && room?.role === "READONLY";
    args.card.dataset.chatReadonly = String(Boolean(readOnly));
    const composerEnabled = Boolean(room) && !readOnly;
    ui.input.disabled = !composerEnabled;
    ui.input.placeholder = readOnly ? "В этой группе вы можете только читать" : "Сообщение…";
    const submit = args.form.querySelector('button[type="submit"]');
    if (submit) submit.disabled = !composerEnabled;
    ui.controls.attachmentButton.disabled = !composerEnabled;
    ui.controls.voiceButton.disabled = !composerEnabled;
    ui.controls.contextClose.disabled = !room;
  };

  return ui;
}

export { installChatConsoleStyles, CHAT_ROOM_KIND_LABELS, CHAT_ROLE_LABELS };
