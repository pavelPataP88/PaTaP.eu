import { createRadioExperienceUi, isAccidentalRecording } from "./experience.mjs?v=20260818-radio2";
import { createRadioConsoleUi, RADIO_ROLE_LABELS, RADIO_POLICY_LABELS } from "./console.mjs?v=20260818-radio2";
import { createRadioLiveAudio } from "./live-audio.mjs?v=20260818-radio2";

const MAX_RECORDING_MS = 60_000;
const MIN_RECORDING_MS = 550;
const RECORDING_TICK_MS = 200;
const MAX_AUDIO_BYTES = 3 * 1024 * 1024;
const POLL_MS = 12_000;
const VOICE_BITRATE = 32_000;
const CANCEL_GESTURE_MARGIN_PX = 12;

const PHASE_LABELS = Object.freeze({
  disabled: "Отключено",
  ready: "Готово",
  requesting: "Микрофон",
  recording: "Запись",
  sending: "Отправка",
  sent: "Доставлено",
  listening: "Эфир занят",
  error: "Ошибка"
});

function radioAudioConstraints() {
  const supported = navigator.mediaDevices?.getSupportedConstraints?.() || {};
  const audio = {};
  if (supported.echoCancellation) audio.echoCancellation = true;
  if (supported.noiseSuppression) audio.noiseSuppression = true;
  if (supported.autoGainControl) audio.autoGainControl = true;
  if (supported.channelCount) audio.channelCount = 1;
  return Object.keys(audio).length ? { audio } : { audio: true };
}

function supportedMimeType() {
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"];
  return candidates.find((type) => globalThis.MediaRecorder?.isTypeSupported?.(type)) || "";
}

function createVoiceRecorder(stream, mimeType) {
  const options = mimeType ? { mimeType } : {};
  options.audioBitsPerSecond = VOICE_BITRATE;
  try { return new MediaRecorder(stream, options); }
  catch { return mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream); }
}

function formatAudioTime(value) {
  const seconds = Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function friendlyRadioError(error) {
  const code = String(error?.message || "");
  const labels = {
    radio_channel_not_found: "Канал больше недоступен.",
    radio_channel_forbidden: "Недостаточно прав для этого действия.",
    radio_channel_banned: "Доступ к этому каналу закрыт модератором.",
    radio_talk_not_allowed: "В этом канале у вас сейчас режим только прослушивания.",
    radio_contact_required: "Для этого действия нужен подтверждённый контакт.",
    radio_rate_limited: "Слишком много действий подряд. Попробуйте немного позже.",
    radio_owner_transfer_required: "Сначала передайте права владельца другому участнику.",
    radio_pin_limit: "Можно закрепить максимум три передачи.",
    radio_alert_forbidden: "В этом канале вызов недоступен."
  };
  return labels[code] || "Не удалось выполнить действие рации.";
}

export function createRadioController({ api, uploadBinary, onAuthLost }) {
  const navButton = document.querySelector('[data-driver-target="radio"]');
  const radioCard = document.querySelector(".radio-card");
  const title = document.querySelector("#radio-channel-title");
  const state = document.querySelector("#radio-state");
  const channelsElement = document.querySelector("#radio-channels");
  const help = document.querySelector("#radio-help");
  const transmissionsElement = document.querySelector("#radio-transmissions");
  const ptt = document.querySelector("#radio-ptt");
  const consoleUi = createRadioConsoleUi({ card: radioCard, title, state, channelsElement, help, transmissionsElement, ptt });
  const experience = createRadioExperienceUi({ card: radioCard, ptt, mount: consoleUi.liveMount });
  const channels = new Map();
  const knownLastIds = new Map();
  const pinnedIds = new Set();
  let channel = null;
  let profileReady = false;
  let ownNickname = "";
  let activated = false;
  let pollTimer = null;
  let eventSource = null;
  let liveEventSource = null;
  let recorder = null;
  let stream = null;
  let recording = null;
  let starting = false;
  let uploading = false;
  let pttHeld = false;
  let pointerCancelOnRelease = false;
  let stopTimer = null;
  let recordingTimer = null;
  let recordingStartedAt = 0;
  let cancelUpload = false;
  let cancelReason = "";
  let activeAudio = null;
  let currentPhase = "disabled";
  let statusLockUntil = 0;
  let settings = { status: "AVAILABLE", soloChannelId: null, defaultChannelId: null, autoPlay: false, playbackRate: 1 };
  let invites = [];
  let alerts = [];
  let historyItems = [];
  let historyPlayers = [];
  let cascadePlayback = false;
  let carMode = false;
  let echoRunning = false;
  let refreshInFlight = null;

  const liveAudio = createRadioLiveAudio({
    uploadBinary,
    canListenToChannel(channelId) {
      return playbackAllowed(channels.get(Number(channelId)));
    },
    onTransportState(mode) {
      radioCard.dataset.liveTransport = mode;
    }
  });

  function setState(text, kind = "ready", { lockMs = 0 } = {}) {
    currentPhase = PHASE_LABELS[kind] ? kind : "ready";
    if (lockMs > 0) statusLockUntil = Date.now() + lockMs;
    state.textContent = text;
    state.dataset.state = currentPhase === "error" ? "error" : currentPhase === "disabled" ? "" : "active";
    experience.setPhase(currentPhase, PHASE_LABELS[currentPhase]);
  }

  function effectiveBusy() { return channel?.speaker && !channel.speaker.isSelf; }

  function updatePtt() {
    const busy = effectiveBusy();
    ptt.disabled = !profileReady || !channel || Boolean(busy) || uploading || channel?.canTalk === false;
    ptt.setAttribute("aria-pressed", recording || starting ? "true" : "false");
    experience.setChannel(channel);
    consoleUi.setChannel(channel);
    if (pointerCancelOnRelease && (recording || starting)) {
      ptt.textContent = "Отпустите — передача отменится";
      experience.setPhase("requesting", "Отмена");
    } else if (recording) {
      ptt.textContent = "Говорите — отпустите для отправки";
      experience.setPhase("recording", PHASE_LABELS.recording);
    } else if (starting) {
      ptt.textContent = "Подключаем микрофон…";
      experience.setPhase("requesting", PHASE_LABELS.requesting);
    } else if (uploading) {
      ptt.textContent = "Отправляем передачу…";
      experience.setPhase("sending", PHASE_LABELS.sending);
    } else if (busy) {
      ptt.textContent = `Говорит ${channel.speaker.nickname}`;
      experience.setPhase("listening", PHASE_LABELS.listening);
    } else if (channel?.canTalk === false) {
      ptt.textContent = "Только прослушивание";
      experience.setPhase("ready", "Слушатель");
    } else {
      ptt.textContent = "Зажми и говори";
      if (!profileReady || !channel) experience.setPhase("disabled", PHASE_LABELS.disabled);
      else experience.setPhase(currentPhase, PHASE_LABELS[currentPhase]);
    }
    ptt.setAttribute("aria-label", pointerCancelOnRelease && (recording || starting)
      ? "Передача будет отменена после отпускания кнопки."
      : recording
        ? `Идёт передача в канал ${channel?.title || "рации"}. Отпустите для отправки, уведите палец с кнопки или нажмите Escape для отмены.`
        : busy
          ? `Канал занят. Сейчас говорит ${channel.speaker.nickname}.`
          : channel?.canTalk === false
            ? `Канал ${channel?.title || "рации"}. У вас режим только прослушивания.`
            : `Зажмите, чтобы говорить в канал ${channel?.title || "рации"}.`);
  }

  function stopRecordingClock() {
    if (recordingTimer) window.clearInterval(recordingTimer);
    recordingTimer = null;
    experience.clearRecordingElapsed();
  }

  function startRecordingClock() {
    stopRecordingClock();
    experience.setRecordingElapsed(0);
    recordingTimer = window.setInterval(() => {
      if (recordingStartedAt) experience.setRecordingElapsed(Date.now() - recordingStartedAt);
    }, RECORDING_TICK_MS);
  }

  function pauseActiveAudio() {
    if (activeAudio) activeAudio.pause();
    activeAudio = null;
  }

  function playbackAllowed(targetChannel) {
    if (!settings.autoPlay || !targetChannel || targetChannel.muted) return false;
    if (settings.status === "BUSY") return false;
    if (settings.status === "SOLO") return Number(settings.soloChannelId) === Number(targetChannel.id);
    return true;
  }

  async function playIncoming(item, { force = false } = {}) {
    if (!item || item.sender?.nickname === ownNickname) return false;
    if (!force && liveAudio.hasHeard(item.id)) return true;
    const targetChannel = channels.get(Number(item.channelId));
    if (!force && !playbackAllowed(targetChannel)) return false;
    pauseActiveAudio();
    const audio = document.createElement("audio");
    audio.src = `/api/driver/radio/transmissions/${item.id}/audio`;
    audio.playsInline = true;
    audio.preload = "auto";
    audio.playbackRate = Number(settings.playbackRate || 1);
    activeAudio = audio;
    audio.addEventListener("ended", () => { if (activeAudio === audio) activeAudio = null; }, { once: true });
    try { await audio.play(); return true; }
    catch {
      if (activeAudio === audio) activeAudio = null;
      if (force) setState("Браузер не разрешил автоматическое воспроизведение. Нажмите «Повтор».", "error");
      return false;
    }
  }

  async function deleteTransmission(item) {
    if (item.sender.nickname !== ownNickname || !window.confirm("Удалить голосовое сообщение у всех?")) return;
    try {
      await api(`/api/driver/radio/transmissions/${item.id}`, { method: "DELETE", body: {} });
      setState("Голосовое сообщение удалено.", "ready");
      await refreshOverview();
      await loadTransmissions();
    } catch (error) {
      if (error.status === 401) onAuthLost();
      else if (error.status === 404) await loadTransmissions();
      else setState(friendlyRadioError(error), "error");
    }
  }

  function audioExtension(mimeType = "") {
    if (mimeType.includes("ogg")) return "ogg";
    if (mimeType.includes("mp4")) return "m4a";
    return "webm";
  }

  async function togglePin(item) {
    if (!channel?.canModerate || channel.kind === "DIRECT") return;
    const pinned = pinnedIds.has(Number(item.id));
    try {
      await api(`/api/driver/radio/channels/${channel.id}/pins/${item.id}`, { method: pinned ? "DELETE" : "POST", body: {} });
      await loadPins();
      renderTransmissions(historyItems);
      setState(pinned ? "Закрепление снято." : "Передача закреплена в канале.", "ready");
    } catch (error) { setState(friendlyRadioError(error), "error"); }
  }

  function createTransmissionMenu(item) {
    const menu = document.createElement("details");
    menu.className = "message-menu";
    menu.addEventListener("toggle", () => {
      if (!menu.open) return;
      const boundary = menu.closest(".radio-transmissions")?.getBoundingClientRect();
      const trigger = menu.getBoundingClientRect();
      if (boundary) menu.classList.toggle("open-up", trigger.top - boundary.top > boundary.bottom - trigger.bottom);
    });
    const trigger = document.createElement("summary");
    trigger.setAttribute("aria-label", "Действия с голосовым сообщением");
    trigger.textContent = "⋮";
    const actions = document.createElement("div");
    const download = document.createElement("a");
    download.href = `/api/driver/radio/transmissions/${item.id}/audio`;
    download.download = `driver-radio-${item.id}.${audioExtension(item.mimeType)}`;
    download.textContent = "Скачать";
    actions.append(download);
    if (channel?.canModerate && channel.kind !== "DIRECT") {
      const pin = document.createElement("button");
      pin.type = "button";
      pin.textContent = pinnedIds.has(Number(item.id)) ? "Открепить" : "Закрепить";
      pin.addEventListener("click", () => { menu.open = false; togglePin(item); });
      actions.append(pin);
    }
    if (item.sender.nickname === ownNickname) {
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "danger";
      remove.textContent = "Удалить";
      remove.addEventListener("click", () => { menu.open = false; deleteTransmission(item); });
      actions.append(remove);
    }
    menu.append(trigger, actions);
    return menu;
  }

  function createAudioPlayer(item, index) {
    const player = document.createElement("div");
    player.className = "radio-audio-player";
    const play = document.createElement("button");
    play.type = "button";
    play.className = "radio-audio-play";
    play.setAttribute("aria-label", "Воспроизвести голосовое сообщение");
    play.textContent = "▶";
    const progress = document.createElement("input");
    progress.type = "range";
    progress.className = "radio-audio-progress";
    progress.min = "0"; progress.max = "0"; progress.step = "0.1"; progress.value = "0"; progress.disabled = true;
    progress.setAttribute("aria-label", "Позиция воспроизведения");
    const time = document.createElement("span");
    time.className = "radio-audio-time"; time.textContent = "0:00";
    const audio = document.createElement("audio");
    audio.preload = "metadata"; audio.playsInline = true; audio.src = `/api/driver/radio/transmissions/${item.id}/audio`;
    audio.playbackRate = Number(settings.playbackRate || 1);

    async function playHere({ cascade = true } = {}) {
      if (!audio.paused) { audio.pause(); return; }
      if (activeAudio && activeAudio !== audio) activeAudio.pause();
      activeAudio = audio;
      cascadePlayback = cascade;
      audio.playbackRate = Number(settings.playbackRate || 1);
      try { await audio.play(); }
      catch { if (activeAudio === audio) activeAudio = null; setState("Не удалось воспроизвести голосовое сообщение.", "error"); }
    }
    play.addEventListener("click", () => playHere({ cascade: true }));
    audio.addEventListener("play", () => { activeAudio = audio; play.textContent = "❚❚"; play.setAttribute("aria-label", "Приостановить голосовое сообщение"); });
    audio.addEventListener("pause", () => { play.textContent = "▶"; play.setAttribute("aria-label", "Воспроизвести голосовое сообщение"); if (activeAudio === audio) activeAudio = null; });
    audio.addEventListener("durationchange", () => {
      const duration = Number.isFinite(audio.duration) ? audio.duration : 0;
      progress.max = String(duration); progress.disabled = duration <= 0;
      time.textContent = `${formatAudioTime(audio.currentTime)} / ${formatAudioTime(duration)}`;
    });
    audio.addEventListener("timeupdate", () => { progress.value = String(audio.currentTime); time.textContent = `${formatAudioTime(audio.currentTime)} / ${formatAudioTime(audio.duration)}`; });
    audio.addEventListener("ended", () => {
      progress.value = "0"; play.textContent = "▶";
      if (activeAudio === audio) activeAudio = null;
      if (cascadePlayback && historyPlayers[index + 1]) historyPlayers[index + 1].playHere({ cascade: true });
    });
    progress.addEventListener("input", () => { audio.currentTime = Number(progress.value); });
    player.append(play, progress, time, audio);
    return { element: player, audio, playHere };
  }

  function renderTransmissions(items = []) {
    historyItems = Array.isArray(items) ? items.slice() : [];
    historyPlayers = [];
    transmissionsElement.replaceChildren();
    if (!historyItems.length) {
      const empty = document.createElement("p"); empty.className = "radio-empty";
      empty.textContent = channel ? "В этом канале ещё нет передач." : "Выберите канал рации.";
      transmissionsElement.append(empty); return;
    }
    historyItems.forEach((item, index) => {
      const article = document.createElement("article"); article.className = "radio-transmission"; article.dataset.transmissionId = String(item.id);
      const header = document.createElement("header");
      const author = document.createElement("strong"); author.textContent = item.sender.nickname;
      const time = document.createElement("time"); time.dateTime = item.committedAt; time.textContent = new Date(item.committedAt).toLocaleString([], { dateStyle: "short", timeStyle: "short" });
      const menu = createTransmissionMenu(item); header.append(author, time, menu);
      const player = createAudioPlayer(item, index); historyPlayers.push(player); article.append(header, player.element); transmissionsElement.append(article);
    });
    transmissionsElement.scrollTop = transmissionsElement.scrollHeight;
  }

  async function loadTransmissions({ silent = false, limit = 50 } = {}) {
    if (!channel) { renderTransmissions(); return []; }
    try {
      const data = await api(`/api/driver/radio/channels/${channel.id}/transmissions?limit=${limit}`);
      const items = data.transmissions || []; renderTransmissions(items); return items;
    } catch (error) {
      if (error.status === 401) onAuthLost(); else if (!silent) setState("Не удалось загрузить передачи.", "error");
      return null;
    }
  }

  function transmissionCommitted(items, transmissionId) {
    return Array.isArray(items) ? items.some((item) => Number(item.id) === Number(transmissionId)) : null;
  }

  async function loadPins() {
    pinnedIds.clear();
    if (!channel || channel.kind === "DIRECT") { consoleUi.renderPins([]); return []; }
    try {
      const data = await api(`/api/driver/radio/channels/${channel.id}/pins`);
      for (const item of data.pins || []) pinnedIds.add(Number(item.id));
      consoleUi.renderPins(data.pins || [], (item) => playIncoming(item, { force: true }));
      return data.pins || [];
    } catch { consoleUi.renderPins([]); return []; }
  }

  async function markCurrentRead() {
    if (!channel?.lastTransmissionId) return;
    try {
      await api(`/api/driver/radio/channels/${channel.id}/preferences`, { method: "PATCH", body: { lastReadTransmissionId: channel.lastTransmissionId } });
      channel.unreadCount = 0; channels.set(channel.id, channel); renderChannelList();
    } catch { }
  }

  function renderChannelList() {
    consoleUi.renderChannels([...channels.values()], { activeId: channel?.id, onSelect: selectChannel });
  }

  async function selectChannel(next, { keepStatus = false } = {}) {
    if (!next || recording || starting || uploading) return;
    pauseActiveAudio();
    channel = channels.get(Number(next.id)) || next;
    title.textContent = `Рация: ${channel.title}`;
    experience.setChannel(channel); consoleUi.setChannel(channel); renderChannelList();
    if (settings.status === "SOLO" && !keepStatus && Number(settings.soloChannelId) !== Number(channel.id)) {
      await updateSettings({ status: "SOLO", soloChannelId: channel.id }, { quiet: true });
    }
    if (channel.speaker && !channel.speaker.isSelf) setState(`Сейчас говорит ${channel.speaker.nickname}.`, "listening");
    else if (channel.canTalk === false) setState("Канал выбран. Вы можете слушать передачи.", "ready");
    else setState("Канал выбран. Зажмите кнопку, чтобы говорить.", "ready");
    updatePtt();
    await Promise.all([loadTransmissions(), loadPins()]);
    await markCurrentRead();
  }

  async function fetchLatest(channelId) {
    try { const data = await api(`/api/driver/radio/channels/${channelId}/transmissions?limit=1`); return data.transmissions?.at(-1) || null; }
    catch { return null; }
  }

  async function handleNewTransmission(targetChannel, oldId, newId) {
    if (!newId || Number(newId) <= Number(oldId || 0)) return;
    const latest = await fetchLatest(targetChannel.id);
    if (!latest || Number(latest.id) !== Number(newId)) return;
    if (Number(channel?.id) === Number(targetChannel.id) && !recording && !starting) {
      await loadTransmissions({ silent: true }); await markCurrentRead();
    }
    if (latest.sender.nickname !== ownNickname) await playIncoming(latest);
  }

  async function performOverviewRefresh({ initial = false } = {}) {
    if (!profileReady) return;
    try {
      const data = await api("/api/driver/radio/overview");
      const previousId = channel?.id;
      const previousLast = new Map(knownLastIds);
      channels.clear();
      for (const item of data.channels || []) {
        channels.set(Number(item.id), item);
        knownLastIds.set(Number(item.id), Number(item.lastTransmissionId || 0));
      }
      settings = data.settings || settings; invites = data.invites || []; alerts = data.alerts || [];
      consoleUi.setSettings(settings); consoleUi.setInvitesCount(invites.length); consoleUi.showAlert(alerts[0] || null);
      syncLiveEventStream();
      const preferred = previousId && channels.get(Number(previousId))
        || settings.defaultChannelId && channels.get(Number(settings.defaultChannelId))
        || channels.values().next().value || null;
      channel = preferred; renderChannelList(); consoleUi.setChannel(channel); experience.setChannel(channel); updatePtt();
      if (!initial) {
        for (const item of channels.values()) {
          const oldId = Number(previousLast.get(item.id) || 0); const newId = Number(item.lastTransmissionId || 0);
          if (previousLast.has(item.id) && newId > oldId) handleNewTransmission(item, oldId, newId);
        }
      }
      if (channel?.speaker && !channel.speaker.isSelf && !recording && !starting && !uploading) setState(`Сейчас говорит ${channel.speaker.nickname}.`, "listening");
      else if (!recording && !starting && !uploading && channel && Date.now() >= statusLockUntil) setState(channel.canTalk === false ? "Канал активен. Режим прослушивания." : "Канал свободен. Можно говорить.", "ready");
    } catch (error) {
      if (error.status === 401) onAuthLost(); else if (!initial) setState("Не удалось обновить состояние рации.", "error");
    }
  }

  function refreshOverview(options = {}) {
    if (refreshInFlight) return refreshInFlight;
    refreshInFlight = performOverviewRefresh(options).finally(() => { refreshInFlight = null; });
    return refreshInFlight;
  }

  async function refreshChannels() { return refreshOverview(); }

  function connectEventStream() {
    if (!activated || eventSource || typeof EventSource === "undefined") return;
    eventSource = new EventSource("/api/driver/radio/events");
    eventSource.addEventListener("radio", (event) => {
      try {
        const payload = JSON.parse(event.data || "{}");
        if (payload.type === "radio.refresh") refreshOverview();
      } catch { }
    });
    eventSource.addEventListener("open", () => { if (currentPhase === "error" && channel) setState("Связь с рацией восстановлена.", "ready"); });
    // EventSource performs its own backoff/reconnect. Fallback polling remains active independently.
  }

  function closeEventStream() {
    if (eventSource) eventSource.close();
    eventSource = null;
  }

  function connectLiveEventStream() {
    if (!activated || liveEventSource || typeof EventSource === "undefined" || !settings.autoPlay || settings.status === "BUSY") return;
    liveEventSource = new EventSource("/api/driver/radio/live-events");
    liveEventSource.addEventListener("radio-live", (event) => {
      try {
        const payload = JSON.parse(event.data || "{}");
        if (payload.type === "radio.live") void liveAudio.handleIncoming(payload);
      } catch { }
    });
  }

  function closeLiveEventStream() {
    if (liveEventSource) liveEventSource.close();
    liveEventSource = null;
  }

  function syncLiveEventStream() {
    if (settings.autoPlay && settings.status !== "BUSY") connectLiveEventStream();
    else closeLiveEventStream();
  }

  function schedulePoll() {
    if (pollTimer) window.clearInterval(pollTimer);
    pollTimer = activated ? window.setInterval(() => refreshOverview(), POLL_MS) : null;
  }

  async function updateSettings(patch, { quiet = false } = {}) {
    try {
      const data = await api("/api/driver/radio/settings", { method: "PATCH", body: patch });
      settings = data.settings; consoleUi.setSettings(settings); syncLiveEventStream();
      if (!quiet) setState("Настройки рации сохранены.", "ready");
      return true;
    } catch (error) {
      consoleUi.setSettings(settings); syncLiveEventStream(); if (!quiet) setState(friendlyRadioError(error), "error"); return false;
    }
  }

  async function updateChannelPreferences(patch) {
    if (!channel) return false;
    try {
      const data = await api(`/api/driver/radio/channels/${channel.id}/preferences`, { method: "PATCH", body: patch });
      Object.assign(channel, data.preferences || {}); channels.set(channel.id, channel); consoleUi.setChannel(channel); renderChannelList(); return true;
    } catch (error) { setState(friendlyRadioError(error), "error"); return false; }
  }

  async function replayLast() {
    let item = historyItems.at(-1);
    if (!item && channel) item = await fetchLatest(channel.id);
    if (!item) return setState("В этом канале пока нечего повторять.", "ready");
    if (historyItems.length && historyPlayers.length) historyPlayers.at(-1).playHere({ cascade: false });
    else await playIncoming(item, { force: true });
  }

  async function runEchoTest() {
    if (echoRunning || recording || starting || uploading) return;
    if (!navigator.mediaDevices?.getUserMedia || !globalThis.MediaRecorder) return setState("Тест микрофона не поддерживается этим браузером.", "error");
    echoRunning = true; setState("Тест микрофона: скажите несколько слов…", "requesting");
    let localStream;
    try {
      localStream = await navigator.mediaDevices.getUserMedia(radioAudioConstraints());
      const mimeType = supportedMimeType(); const echoRecorder = createVoiceRecorder(localStream, mimeType); const chunks = [];
      echoRecorder.addEventListener("dataavailable", (event) => { if (event.data?.size) chunks.push(event.data); });
      const stopped = new Promise((resolve) => echoRecorder.addEventListener("stop", resolve, { once: true }));
      echoRecorder.start(250); await new Promise((resolve) => window.setTimeout(resolve, 3_000)); echoRecorder.stop(); await stopped;
      for (const track of localStream.getTracks()) track.stop(); localStream = null;
      const blob = new Blob(chunks, { type: echoRecorder.mimeType || "audio/webm" }); if (!blob.size) throw new Error("empty_echo");
      pauseActiveAudio(); const audio = document.createElement("audio"); audio.src = URL.createObjectURL(blob); audio.playbackRate = 1; activeAudio = audio;
      audio.addEventListener("ended", () => { URL.revokeObjectURL(audio.src); if (activeAudio === audio) activeAudio = null; }, { once: true });
      await audio.play(); setState("Тест микрофона воспроизводится только на этом устройстве. На сервер ничего не отправлено.", "ready");
    } catch (error) {
      for (const track of localStream?.getTracks?.() || []) track.stop();
      setState(error.name === "NotAllowedError" ? "Микрофон запрещён браузером." : "Не удалось выполнить тест микрофона.", "error");
    } finally { echoRunning = false; }
  }

  function showCreateChannel() {
    const form = consoleUi.makeForm([
      { name: "title", label: "Название канала", required: true, maxLength: 48 },
      { name: "description", label: "Описание", type: "textarea", maxLength: 240 },
      { name: "visibility", label: "Доступ", type: "select", options: [["PRIVATE", "Закрытый — только по приглашению"], ["PUBLIC", "Открытый — можно найти и вступить"]] },
      { name: "talkPolicy", label: "Кто может говорить", type: "select", options: [["EVERYONE", "Все участники"], ["TRUSTED", "Владелец, модераторы и доверенные"], ["BROADCAST", "Только владелец и модераторы"]] }
    ], "Создать канал", async (values) => {
      try {
        const data = await api("/api/driver/radio/channels", { method: "POST", body: values });
        await refreshOverview(); await selectChannel(channels.get(Number(data.channel.id)) || data.channel); setState("Канал создан.", "ready");
      } catch (error) { setState(friendlyRadioError(error), "error"); return false; }
    });
    consoleUi.showDialog("Новый канал", form);
  }

  async function showDiscover() {
    const wrap = document.createElement("div");
    const input = document.createElement("input"); input.type = "search"; input.placeholder = "Название открытого канала"; input.setAttribute("aria-label", "Поиск открытых каналов");
    const results = document.createElement("div"); results.style.display = "grid"; results.style.gap = "8px"; wrap.append(input, results);
    let timer = null;
    async function search() {
      try {
        const data = await api(`/api/driver/radio/discover?q=${encodeURIComponent(input.value.trim())}`); results.replaceChildren();
        for (const item of data.channels || []) {
          const join = consoleUi.makeAction(item.joined ? "Уже в канале" : "Вступить", async () => {
            if (item.joined) return;
            try { await api(`/api/driver/radio/channels/${item.id}/join`, { method: "POST", body: {} }); await refreshOverview(); join.textContent = "Уже в канале"; join.disabled = true; }
            catch (error) { setState(friendlyRadioError(error), "error"); }
          });
          join.disabled = item.joined;
          results.append(consoleUi.makeRow({ title: item.title, subtitle: `${item.memberCount} участн. · ${item.description || RADIO_POLICY_LABELS[item.talkPolicy] || ""}`, actions: [join] }));
        }
        if (!results.childNodes.length) { const p = document.createElement("p"); p.className = "radio-empty"; p.textContent = "Открытые каналы не найдены."; results.append(p); }
      } catch { results.textContent = "Не удалось загрузить список каналов."; }
    }
    input.addEventListener("input", () => { if (timer) window.clearTimeout(timer); timer = window.setTimeout(search, 250); });
    consoleUi.showDialog("Найти канал", wrap); await search();
  }

  function showInvites() {
    const rows = [];
    for (const invite of invites) {
      const accept = consoleUi.makeAction("Принять", async () => { try { await api(`/api/driver/radio/invites/${invite.channelId}/respond`, { method: "POST", body: { action: "ACCEPT" } }); await refreshOverview(); showInvites(); } catch (error) { setState(friendlyRadioError(error), "error"); } });
      const decline = consoleUi.makeAction("Отклонить", async () => { try { await api(`/api/driver/radio/invites/${invite.channelId}/respond`, { method: "POST", body: { action: "DECLINE" } }); await refreshOverview(); showInvites(); } catch (error) { setState(friendlyRadioError(error), "error"); } });
      rows.push(consoleUi.makeRow({ title: invite.title, subtitle: `${invite.invitedBy} · ${invite.memberCount} участн.`, actions: [accept, decline] }));
    }
    if (!rows.length) { const p = document.createElement("p"); p.className = "radio-empty"; p.textContent = "Новых приглашений нет."; rows.push(p); }
    consoleUi.showDialog("Приглашения в каналы", rows);
  }

  async function showMembers() {
    if (!channel || channel.kind === "DIRECT") return;
    const wrap = document.createElement("div"); wrap.style.display = "grid"; wrap.style.gap = "8px";
    if (channel.canModerate) {
      const inviteForm = consoleUi.makeForm([{ name: "nickname", label: "Пригласить подтверждённый контакт по нику", required: true, maxLength: 32 }], "Пригласить", async ({ nickname }) => {
        try { await api(`/api/driver/radio/channels/${channel.id}/invites`, { method: "POST", body: { nickname } }); setState(`Приглашение отправлено: ${nickname}.`, "ready"); return true; }
        catch (error) { setState(friendlyRadioError(error), "error"); return false; }
      });
      wrap.append(inviteForm);
    }
    try {
      const data = await api(`/api/driver/radio/channels/${channel.id}/members`);
      for (const member of data.members || []) {
        const actions = [];
        if (channel.canManage && member.nickname !== ownNickname) {
          const roleSelect = consoleUi.makeSelect([["OWNER", "Владелец"], ["MODERATOR", "Модератор"], ["TRUSTED", "Доверенный"], ["MEMBER", "Участник"], ["LISTENER", "Слушатель"]], member.role, async (role) => {
            if (role === "OWNER" && !window.confirm(`Передать владение каналом пользователю ${member.nickname}?`)) return showMembers();
            try { await api(`/api/driver/radio/channels/${channel.id}/members/${encodeURIComponent(member.nickname)}`, { method: "PATCH", body: { role } }); await refreshOverview(); showMembers(); }
            catch (error) { setState(friendlyRadioError(error), "error"); }
          });
          actions.push(roleSelect);
        }
        const removable = channel.canModerate && member.nickname !== ownNickname && member.role !== "OWNER" && !(channel.role === "MODERATOR" && member.role === "MODERATOR");
        if (removable) {
          actions.push(consoleUi.makeAction("Убрать", async () => { if (!window.confirm(`Убрать ${member.nickname} из канала?`)) return; try { await api(`/api/driver/radio/channels/${channel.id}/members/${encodeURIComponent(member.nickname)}`, { method: "DELETE", body: { ban: false } }); await refreshOverview(); showMembers(); } catch (error) { setState(friendlyRadioError(error), "error"); } }));
          actions.push(consoleUi.makeAction("Бан", async () => { if (!window.confirm(`Заблокировать ${member.nickname} в этом канале?`)) return; try { await api(`/api/driver/radio/channels/${channel.id}/members/${encodeURIComponent(member.nickname)}`, { method: "DELETE", body: { ban: true } }); await refreshOverview(); showMembers(); } catch (error) { setState(friendlyRadioError(error), "error"); } }));
        }
        wrap.append(consoleUi.makeRow({ title: member.nickname, subtitle: `${RADIO_ROLE_LABELS[member.role] || member.role} · ${member.driverType}`, actions }));
      }
      consoleUi.showDialog(`Участники · ${channel.title}`, wrap);
    } catch (error) { setState(friendlyRadioError(error), "error"); }
  }

  function showChannelSettings() {
    if (!channel) return;
    if (channel.kind === "GROUP" && channel.canManage) {
      const form = consoleUi.makeForm([
        { name: "title", label: "Название", value: channel.title, required: true, maxLength: 48 },
        { name: "description", label: "Описание", type: "textarea", value: channel.description || "", maxLength: 240 },
        { name: "visibility", label: "Доступ", type: "select", value: channel.visibility, options: [["PRIVATE", "Закрытый"], ["PUBLIC", "Открытый"]] },
        { name: "talkPolicy", label: "Кто может говорить", type: "select", value: channel.talkPolicy, options: [["EVERYONE", "Все"], ["TRUSTED", "Доверенные"], ["BROADCAST", "Вещание"]] }
      ], "Сохранить", async (values) => {
        try { await api(`/api/driver/radio/channels/${channel.id}`, { method: "PATCH", body: values }); await refreshOverview(); setState("Канал обновлён.", "ready"); }
        catch (error) { setState(friendlyRadioError(error), "error"); return false; }
      });
      const remove = consoleUi.makeAction("Удалить канал", async () => {
        if (!window.confirm(`Удалить канал «${channel.title}» и его голосовую историю?`)) return;
        try { await api(`/api/driver/radio/channels/${channel.id}`, { method: "DELETE", body: {} }); channel = null; await refreshOverview({ initial: true }); if (channels.size) await selectChannel(channels.values().next().value); consoleUi.closeDialog(); setState("Канал удалён.", "ready"); }
        catch (error) { setState(friendlyRadioError(error), "error"); }
      });
      form.append(remove); consoleUi.showDialog(`Настройки · ${channel.title}`, form); return;
    }
    if (channel.kind === "GROUP") {
      const leave = consoleUi.makeAction("Выйти из канала", async () => {
        if (!window.confirm(`Выйти из канала «${channel.title}»?`)) return;
        try { await api(`/api/driver/radio/channels/${channel.id}/leave`, { method: "POST", body: {} }); channel = null; await refreshOverview({ initial: true }); consoleUi.closeDialog(); }
        catch (error) { setState(friendlyRadioError(error), "error"); }
      });
      consoleUi.showDialog(`Канал · ${channel.title}`, [leave]);
    }
  }

  function carStep(delta) {
    const items = [...channels.values()]; if (!items.length) return;
    const index = Math.max(0, items.findIndex((item) => Number(item.id) === Number(channel?.id)));
    selectChannel(items[(index + delta + items.length) % items.length]);
  }

  async function sendChannelAlert() {
    if (!channel) return;
    try { const data = await api(`/api/driver/radio/channels/${channel.id}/alerts`, { method: "POST", body: {} }); consoleUi.showAlert({ ...data.alert, channelTitle: channel.title }); setState("Сигнал внимания отправлен участникам канала.", "ready"); }
    catch (error) { setState(friendlyRadioError(error), "error"); }
  }

  function bindConsole() {
    const c = consoleUi.controls;
    c.statusSelect.addEventListener("change", async () => {
      const status = c.statusSelect.value;
      if (status === "SOLO" && !channel) { c.statusSelect.value = settings.status; return setState("Сначала выберите канал для Solo.", "error"); }
      await updateSettings({ status, soloChannelId: status === "SOLO" ? channel.id : null });
    });
    c.createButton.addEventListener("click", showCreateChannel);
    c.discoverButton.addEventListener("click", showDiscover);
    c.invitesButton.addEventListener("click", showInvites);
    c.echoButton.addEventListener("click", runEchoTest);
    c.carButton.addEventListener("click", () => { carMode = !carMode; consoleUi.setCarMode(carMode); });
    c.exitCarButton.addEventListener("click", () => { carMode = false; consoleUi.setCarMode(false); });
    c.prevButton.addEventListener("click", () => carStep(-1));
    c.nextButton.addEventListener("click", () => carStep(1));
    c.carReplayButton.addEventListener("click", replayLast);
    c.replayButton.addEventListener("click", replayLast);
    c.liveButton.addEventListener("click", async () => {
      const enable = !settings.autoPlay;
      if (enable && !(await liveAudio.unlockListening())) {
        setState("Браузер не разрешил живое воспроизведение. Проверьте звук и попробуйте ещё раз.", "error");
        return;
      }
      await updateSettings({ autoPlay: enable });
    });
    c.speedSelect.addEventListener("change", async () => {
      const rate = Number(c.speedSelect.value);
      if (await updateSettings({ playbackRate: rate })) { for (const player of historyPlayers) player.audio.playbackRate = rate; if (activeAudio) activeAudio.playbackRate = rate; }
    });
    c.favoriteButton.addEventListener("click", () => updateChannelPreferences({ favorite: !channel?.favorite }));
    c.muteButton.addEventListener("click", () => updateChannelPreferences({ muted: !channel?.muted }));
    c.defaultButton.addEventListener("click", async () => { if (!channel) return; await updateSettings({ defaultChannelId: channel.isDefault ? null : channel.id }); await refreshOverview({ initial: true }); });
    c.membersButton.addEventListener("click", showMembers);
    c.alertButton.addEventListener("click", sendChannelAlert);
    c.settingsButton.addEventListener("click", showChannelSettings);
  }

  function closeStream() { for (const track of stream?.getTracks?.() || []) track.stop(); stream = null; }

  async function cancelTransmission(session) {
    if (!session) return false;
    try { await api(`/api/driver/radio/transmissions/${session.transmissionId}/audio`, { method: "DELETE", headers: { "X-Radio-Upload-Token": session.uploadToken } }); return true; }
    catch { return false; }
  }

  async function finishRecording(chunks, mimeType, session) {
    await liveAudio.stopBroadcast({ flush: !cancelUpload });
    recording = null; recordingStartedAt = 0; pointerCancelOnRelease = false; stopRecordingClock(); uploading = true;
    ptt.classList.remove("recording"); updatePtt(); closeStream();
    if (cancelUpload) {
      const message = cancelReason || "Передача отменена."; cancelUpload = false; cancelReason = ""; uploading = false;
      await cancelTransmission(session); setState(message, message.includes("не отправлена") ? "error" : "ready"); updatePtt(); return;
    }
    const blob = new Blob(chunks, { type: mimeType || "audio/webm" });
    if (!blob.size) { uploading = false; updatePtt(); await cancelTransmission(session); return setState("Пустая запись не отправлена.", "error"); }
    if (blob.size > MAX_AUDIO_BYTES) { uploading = false; updatePtt(); await cancelTransmission(session); return setState("Запись больше 3 МиБ и не отправлена.", "error"); }
    setState("Отправляем передачу. Пока нет подтверждения сервера, она не считается доставленной.", "sending");
    try {
      await uploadBinary(`/api/driver/radio/transmissions/${session.transmissionId}/audio`, blob, { headers: { "X-Radio-Upload-Token": session.uploadToken } });
      await refreshChannels(); await loadTransmissions(); setState("Передача доставлена.", "sent", { lockMs: 2500 });
    } catch (error) {
      if (error.status === 401) onAuthLost();
      else {
        const firstCheck = await loadTransmissions({ silent: true });
        const firstCommitted = transmissionCommitted(firstCheck, session.transmissionId);
        if (firstCommitted) setState("Передача доставлена. Ответ загрузки был потерян, но передача уже есть в канале.", "sent", { lockMs: 2500 });
        else if (firstCommitted === false) {
          const cancelled = await cancelTransmission(session);
          if (!cancelled) {
            const secondCheck = await loadTransmissions({ silent: true });
            const secondCommitted = transmissionCommitted(secondCheck, session.transmissionId);
            if (secondCommitted) { setState("Передача доставлена. Сервер подтвердил её после повторной проверки канала.", "sent", { lockMs: 2500 }); return; }
            if (secondCommitted === null) { setState("Не удалось подтвердить доставку. Проверьте канал после восстановления сети.", "error"); return; }
          }
          if (cancelled) {
            if (error.message === "radio_upload_not_authorized") setState("Время передачи истекло. Запись не отправлена.", "error");
            else if (globalThis.navigator?.onLine === false) setState("Нет сети. Передача не отправлена.", "error");
            else setState("Сервер не подтвердил передачу. Запись отменена и не отправлена.", "error");
          } else setState("Передача не найдена в канале, но сервер не подтвердил отмену. Проверьте канал ещё раз.", "error");
        } else setState("Не удалось подтвердить доставку. Проверьте канал после восстановления сети.", "error");
      }
    } finally { uploading = false; updatePtt(); }
  }

  async function startRecording(event) {
    event?.preventDefault?.();
    if (ptt.disabled || recording || starting || uploading || !channel) return;
    if (!navigator.mediaDevices?.getUserMedia || !globalThis.MediaRecorder) return setState("Этот браузер не поддерживает запись с микрофона.", "error");
    pttHeld = true; pointerCancelOnRelease = false; starting = true; cancelUpload = false; cancelReason = "";
    if (event?.pointerId !== undefined) ptt.setPointerCapture?.(event.pointerId);
    setState(`Подключаем микрофон для канала «${channel.title}»…`, "requesting"); updatePtt();
    try {
      stream = await navigator.mediaDevices.getUserMedia(radioAudioConstraints());
      if (!pttHeld) { closeStream(); setState(cancelReason || "Передача отменена до начала записи.", "ready"); return; }
      const lease = await api(`/api/driver/radio/channels/${channel.id}/ptt`, { method: "POST", body: {} });
      if (!pttHeld) { closeStream(); await cancelTransmission(lease); setState(cancelReason || "Передача отменена до начала записи.", "ready"); return; }
      const mimeType = supportedMimeType(); recorder = createVoiceRecorder(stream, mimeType); const chunks = []; const recordedMimeType = recorder.mimeType; recording = lease;
      recorder.addEventListener("dataavailable", (item) => { if (item.data?.size) chunks.push(item.data); });
      recorder.addEventListener("stop", () => finishRecording(chunks, recordedMimeType, lease), { once: true });
      recorder.start(1_000); recordingStartedAt = Date.now(); startRecordingClock(); ptt.classList.add("recording"); setState(`Вы говорите в канал «${channel.title}».`, "recording"); updatePtt();
      void liveAudio.startBroadcast(stream, lease);
      stopTimer = window.setTimeout(() => { if (pointerCancelOnRelease) cancelRecording(undefined); else stopRecording(undefined); }, MAX_RECORDING_MS);
    } catch (error) {
      await liveAudio.stopBroadcast({ flush: false });
      closeStream(); recording = null; recordingStartedAt = 0; pointerCancelOnRelease = false; stopRecordingClock();
      if (error.status === 401) onAuthLost();
      else if (error.message === "radio_channel_busy") setState(error.speaker ? `Сейчас говорит ${error.speaker}.` : "Канал уже занят другим водителем.", "listening");
      else if (error.message === "radio_talk_not_allowed") setState("В этом канале у вас режим только прослушивания.", "error");
      else if (error.name === "NotAllowedError") setState("Микрофон запрещён. Разрешите доступ к микрофону в настройках браузера и попробуйте снова.", "error");
      else if (globalThis.navigator?.onLine === false) setState("Нет сети. Передача не начиналась.", "error");
      else setState("Не удалось начать передачу.", "error");
    } finally { starting = false; updatePtt(); }
  }

  function stopRecording(event) {
    event?.preventDefault?.();
    const elapsed = recordingStartedAt ? Date.now() - recordingStartedAt : 0;
    pttHeld = false; pointerCancelOnRelease = false;
    if (stopTimer) window.clearTimeout(stopTimer); stopTimer = null;
    if (starting && !recording) { cancelUpload = true; cancelReason = "Передача отменена до начала записи."; setState(cancelReason, "ready"); void liveAudio.stopBroadcast({ flush: false }); return; }
    if (recording && isAccidentalRecording(elapsed, MIN_RECORDING_MS)) { cancelUpload = true; cancelReason = "Слишком короткая запись. Передача не отправлена."; }
    if (recorder?.state === "recording") recorder.stop();
  }

  function cancelRecording(event, reason = "Передача отменена.") {
    event?.preventDefault?.();
    if (!pttHeld && !recording && !starting) return;
    cancelUpload = true; cancelReason = reason; pttHeld = false; pointerCancelOnRelease = false;
    if (stopTimer) window.clearTimeout(stopTimer); stopTimer = null;
    setState("Отменяем передачу…", "requesting");
    if (recorder?.state === "recording") recorder.stop();
    else void liveAudio.stopBroadcast({ flush: false });
  }

  function updateCancelGesture(event) {
    if (!pttHeld || event?.pointerId === undefined) return;
    const rect = ptt.getBoundingClientRect();
    const outside = event.clientX < rect.left - CANCEL_GESTURE_MARGIN_PX || event.clientX > rect.right + CANCEL_GESTURE_MARGIN_PX || event.clientY < rect.top - CANCEL_GESTURE_MARGIN_PX || event.clientY > rect.bottom + CANCEL_GESTURE_MARGIN_PX;
    if (outside === pointerCancelOnRelease) return;
    pointerCancelOnRelease = outside;
    if (outside) { cancelReason = "Передача отменена."; setState("Отпустите палец — передача будет отменена.", "requesting"); }
    else if (recording) setState(`Вы говорите в канал «${channel.title}».`, "recording");
    else if (starting) setState(`Подключаем микрофон для канала «${channel.title}»…`, "requesting");
    updatePtt();
  }

  function finishPointerHold(event) { if (pointerCancelOnRelease) { cancelRecording(event); return; } stopRecording(event); }

  ptt.addEventListener("pointerdown", startRecording);
  ptt.addEventListener("pointermove", updateCancelGesture);
  ptt.addEventListener("pointerup", finishPointerHold);
  ptt.addEventListener("pointercancel", (event) => cancelRecording(event, "Передача отменена из-за прерванного касания."));
  ptt.addEventListener("lostpointercapture", (event) => { if (pttHeld) cancelRecording(event); });
  ptt.addEventListener("contextmenu", (event) => event.preventDefault());
  ptt.addEventListener("selectstart", (event) => event.preventDefault());
  ptt.addEventListener("dragstart", (event) => event.preventDefault());
  ptt.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && (recording || starting || pttHeld)) { cancelRecording(event); return; }
    if ((event.key === " " || event.key === "Enter") && !event.repeat) startRecording(event);
  });
  ptt.addEventListener("keyup", (event) => { if (event.key === " " || event.key === "Enter") stopRecording(event); });
  ptt.addEventListener("blur", (event) => { if (pttHeld) cancelRecording(event, "Передача отменена: кнопка потеряла фокус."); });

  bindConsole(); experience.reset(); consoleUi.setCarMode(false); updatePtt();

  return {
    async activate() {
      activated = true;
      if (!profileReady) return setState("Сначала сохраните профиль водителя.", "error");
      await refreshOverview({ initial: true });
      if (channel) await selectChannel(channel, { keepStatus: true }); else setState("Нет доступного канала рации.", "disabled");
      connectEventStream(); syncLiveEventStream(); schedulePoll();
    },
    setSession({ profile }) { profileReady = Boolean(profile); ownNickname = profile?.nickname || ""; navButton.disabled = !profileReady; updatePtt(); },
    setProfileReady(profile) { profileReady = Boolean(profile); ownNickname = profile?.nickname || ownNickname; navButton.disabled = !profileReady; updatePtt(); },
    async openDirect(nickname) {
      if (!profileReady) throw new Error("driver_profile_required");
      const data = await api("/api/driver/radio/direct", { method: "POST", body: { nickname } });
      channels.set(Number(data.channel.id), data.channel); await refreshOverview({ initial: true }); await selectChannel(channels.get(Number(data.channel.id)) || data.channel);
    },
    reset() {
      activated = false; profileReady = false; ownNickname = ""; pttHeld = false; pointerCancelOnRelease = false; starting = false; uploading = false; cancelUpload = true; cancelReason = ""; statusLockUntil = 0;
      pauseActiveAudio(); closeEventStream(); closeLiveEventStream(); void liveAudio.stopBroadcast({ flush: false }); liveAudio.closeListening();
      if (pollTimer) window.clearInterval(pollTimer); if (stopTimer) window.clearTimeout(stopTimer); pollTimer = null; stopTimer = null; stopRecordingClock();
      if (recorder?.state === "recording") recorder.stop(); closeStream(); recorder = null; recording = null; recordingStartedAt = 0; channel = null;
      channels.clear(); knownLastIds.clear(); pinnedIds.clear(); historyItems = []; historyPlayers = []; invites = []; alerts = [];
      settings = { status: "AVAILABLE", soloChannelId: null, defaultChannelId: null, autoPlay: false, playbackRate: 1 }; carMode = false; refreshInFlight = null;
      renderChannelList(); renderTransmissions(); consoleUi.renderPins([]); consoleUi.showAlert(null); consoleUi.setInvitesCount(0); consoleUi.setSettings(settings); consoleUi.setCarMode(false);
      radioCard.dataset.liveTransport = "off";
      navButton.disabled = true; ptt.classList.remove("recording"); currentPhase = "disabled"; experience.reset(); updatePtt(); setState("Рация отключена", "disabled");
    }
  };
}

export function createDriverModule(context) {
  return createRadioController({ api: context.api, uploadBinary: context.uploadBinary, onAuthLost: context.onAuthLost });
}
