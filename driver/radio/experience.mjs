const STYLE_ID = "patap-radio-experience-v1";

export const RADIO_PHASES = Object.freeze([
  "disabled",
  "ready",
  "requesting",
  "recording",
  "sending",
  "sent",
  "listening",
  "error"
]);

export function formatRecordingTime(milliseconds) {
  const totalSeconds = Math.max(0, Math.floor(Number(milliseconds) || 0) / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export function isAccidentalRecording(milliseconds, minimumMilliseconds = 550) {
  return Number.isFinite(milliseconds) && milliseconds >= 0 && milliseconds < minimumMilliseconds;
}

export function installRadioExperienceStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
.radio-card{position:relative}.radio-live-status{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px 14px;align-items:center;margin:12px 0 0;padding:12px 14px;border:1px solid var(--line);border-radius:16px;background:#0a1914}.radio-live-channel{min-width:0}.radio-live-channel small,.radio-live-phase small{display:block;color:var(--muted);font-size:.7rem;font-weight:800;letter-spacing:.08em;text-transform:uppercase}.radio-live-channel strong{display:block;margin-top:3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:1rem}.radio-live-phase{text-align:right}.radio-live-phase span{display:block;margin-top:3px;color:var(--accent);font-size:.88rem;font-weight:850}.radio-recording-time{grid-column:1/-1;display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:26px;color:var(--muted);font-size:.82rem}.radio-recording-time strong{color:#ffcf7a;font-variant-numeric:tabular-nums}.radio-ptt{width:100%;min-height:104px;margin-top:12px;border:2px solid var(--accent);border-radius:24px;padding:16px 22px;background:linear-gradient(180deg,#17382d,#10251d);color:#f4f8f6;font-size:clamp(1.05rem,3vw,1.3rem);font-weight:900;letter-spacing:.01em;cursor:pointer;touch-action:none;user-select:none;-webkit-user-select:none;box-shadow:0 12px 28px rgba(0,0,0,.28);transition:transform .12s ease,border-color .12s ease,background .12s ease,box-shadow .12s ease}.radio-ptt:focus-visible{outline:3px solid rgba(104,224,173,.42);outline-offset:3px}.radio-ptt:disabled{cursor:not-allowed;opacity:.48}.radio-ptt[data-radio-phase="requesting"]{border-color:#ffcf7a}.radio-ptt[data-radio-phase="recording"]{border-color:#ff8f87;background:linear-gradient(180deg,#5a2725,#321a18);box-shadow:0 0 0 5px rgba(255,143,135,.14),0 12px 28px rgba(0,0,0,.32);transform:scale(.992)}.radio-ptt[data-radio-phase="sending"]{border-color:#8fb9ff}.radio-ptt[data-radio-phase="sent"]{border-color:var(--accent)}.radio-ptt[data-radio-phase="listening"]{border-color:#b9a8ff}.radio-ptt[data-radio-phase="error"]{border-color:#ffaaa2}.radio-ptt-hint{margin:8px 4px 0;color:var(--muted);font-size:.8rem;line-height:1.4}.radio-card[data-radio-phase="recording"] .radio-live-phase span{color:#ffaaa2}.radio-card[data-radio-phase="sending"] .radio-live-phase span{color:#a9c7ff}.radio-card[data-radio-phase="error"] .radio-live-phase span{color:#ffaaa2}.radio-card[data-radio-phase="listening"] .radio-live-phase span{color:#c9bcff}@media(max-width:760px){.radio-card{padding:14px}.radio-live-status{grid-template-columns:1fr;padding:11px 12px}.radio-live-phase{text-align:left}.radio-recording-time{grid-column:1}.radio-ptt{min-height:112px;border-radius:22px;margin-top:10px}.radio-ptt-hint{font-size:.76rem}}
`;
  document.head.append(style);
}

export function createRadioExperienceUi({ card, ptt }) {
  installRadioExperienceStyles();
  const live = document.createElement("section");
  live.className = "radio-live-status";
  live.setAttribute("aria-label", "Состояние рации");

  const channelBox = document.createElement("div");
  channelBox.className = "radio-live-channel";
  const channelCaption = document.createElement("small");
  channelCaption.textContent = "Активный канал";
  const channelName = document.createElement("strong");
  channelName.textContent = "Канал не выбран";
  channelBox.append(channelCaption, channelName);

  const phaseBox = document.createElement("div");
  phaseBox.className = "radio-live-phase";
  phaseBox.setAttribute("aria-hidden", "true");
  const phaseCaption = document.createElement("small");
  phaseCaption.textContent = "Состояние";
  const phaseText = document.createElement("span");
  phaseText.textContent = "Отключено";
  phaseBox.append(phaseCaption, phaseText);

  const timing = document.createElement("div");
  timing.className = "radio-recording-time";
  timing.id = "radio-recording-time";
  const timingText = document.createElement("span");
  timingText.textContent = "Максимум 60 секунд";
  const timingValue = document.createElement("strong");
  timingValue.textContent = "0:00";
  timing.append(timingText, timingValue);

  const hint = document.createElement("p");
  hint.className = "radio-ptt-hint";
  hint.id = "radio-ptt-hint";
  hint.textContent = "Зажмите и говорите. Отпустите для отправки. Для отмены уведите палец за пределы кнопки и отпустите; с клавиатуры — Esc.";

  live.append(channelBox, phaseBox, timing);
  card?.insertBefore(live, card.querySelector(".radio-channels"));
  ptt?.insertAdjacentElement("afterend", hint);
  ptt?.setAttribute("aria-describedby", "radio-ptt-hint radio-recording-time");
  ptt?.setAttribute("aria-pressed", "false");

  return {
    setChannel(channel) {
      if (!channel) channelName.textContent = "Канал не выбран";
      else channelName.textContent = channel.kind === "DIRECT" ? `Прямой · ${channel.title}` : channel.title;
    },
    setPhase(phase, text) {
      const safePhase = RADIO_PHASES.includes(phase) ? phase : "ready";
      if (card) card.dataset.radioPhase = safePhase;
      if (ptt) ptt.dataset.radioPhase = safePhase;
      phaseText.textContent = text || "Готово";
    },
    setRecordingElapsed(milliseconds) {
      timingValue.textContent = formatRecordingTime(milliseconds);
      timingText.textContent = "Идёт запись · максимум 60 секунд";
    },
    clearRecordingElapsed() {
      timingValue.textContent = "0:00";
      timingText.textContent = "Максимум 60 секунд";
    },
    reset() {
      channelName.textContent = "Канал не выбран";
      phaseText.textContent = "Отключено";
      timingValue.textContent = "0:00";
      timingText.textContent = "Максимум 60 секунд";
      if (card) card.dataset.radioPhase = "disabled";
      if (ptt) {
        ptt.dataset.radioPhase = "disabled";
        ptt.setAttribute("aria-pressed", "false");
      }
    }
  };
}
