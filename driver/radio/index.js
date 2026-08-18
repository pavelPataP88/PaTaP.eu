import { createRadioExperienceUi, isAccidentalRecording } from "./experience.mjs?v=20260818-radio1";

const MAX_RECORDING_MS = 60_000;
const MIN_RECORDING_MS = 550;
const RECORDING_TICK_MS = 200;
const MAX_AUDIO_BYTES = 3 * 1024 * 1024;
const POLL_MS = 4_000;
const VOICE_BITRATE = 32_000;

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
  try {
    return new MediaRecorder(stream, options);
  } catch {
    return mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
  }
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
  const experience = createRadioExperienceUi({ card: radioCard, ptt });
  const channels = new Map();
  let channel = null;
  let profileReady = false;
  let ownNickname = "";
  let activated = false;
  let pollTimer = null;
  let recorder = null;
  let stream = null;
  let recording = null;
  let starting = false;
  let uploading = false;
  let pttHeld = false;
  let stopTimer = null;
  let recordingTimer = null;
  let recordingStartedAt = 0;
  let cancelUpload = false;
  let cancelReason = "";
  let activeAudio = null;
  let currentPhase = "disabled";
  let statusLockUntil = 0;

  function setState(text, kind = "ready", { lockMs = 0 } = {}) {
    currentPhase = PHASE_LABELS[kind] ? kind : "ready";
    if (lockMs > 0) statusLockUntil = Date.now() + lockMs;
    state.textContent = text;
    state.dataset.state = currentPhase === "error" ? "error" : currentPhase === "disabled" ? "" : "active";
    experience.setPhase(currentPhase, PHASE_LABELS[currentPhase]);
  }

  function updatePtt() {
    const busy = channel?.speaker && !channel.speaker.isSelf;
    // Do not disable while starting/recording: the same control must reliably receive release/cancel.
    ptt.disabled = !profileReady || !channel || Boolean(busy) || uploading;
    ptt.setAttribute("aria-pressed", recording || starting ? "true" : "false");
    experience.setChannel(channel);
    if (recording) {
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
    } else {
      ptt.textContent = "Зажми и говори";
      if (!profileReady || !channel) experience.setPhase("disabled", PHASE_LABELS.disabled);
      else experience.setPhase(currentPhase, PHASE_LABELS[currentPhase]);
    }
    ptt.setAttribute("aria-label", recording
      ? `Идёт передача в канал ${channel?.title || "рации"}. Отпустите для отправки, Escape для отмены.`
      : busy
        ? `Канал занят. Сейчас говорит ${channel.speaker.nickname}.`
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

  async function deleteTransmission(item) {
    if (item.sender.nickname !== ownNickname || !window.confirm("Удалить голосовое сообщение у всех?")) return;
    try {
      await api(`/api/driver/radio/transmissions/${item.id}`, { method: "DELETE", body: {} });
      setState("Голосовое сообщение удалено.", "ready");
      await refreshChannels();
      await loadTransmissions();
    } catch (error) {
      if (error.status === 401) onAuthLost();
      else if (error.status === 404) await loadTransmissions();
      else setState("Не удалось удалить голосовое сообщение.", "error");
    }
  }

  function audioExtension(mimeType = "") {
    if (mimeType.includes("ogg")) return "ogg";
    if (mimeType.includes("mp4")) return "m4a";
    return "webm";
  }

  function formatAudioTime(value) {
    const seconds = Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  }

  function createAudioPlayer(item) {
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
    progress.min = "0";
    progress.max = "0";
    progress.step = "0.1";
    progress.value = "0";
    progress.disabled = true;
    progress.setAttribute("aria-label", "Позиция воспроизведения");
    const time = document.createElement("span");
    time.className = "radio-audio-time";
    time.textContent = "0:00";
    const audio = document.createElement("audio");
    audio.preload = "metadata";
    audio.playsInline = true;
    audio.src = `/api/driver/radio/transmissions/${item.id}/audio`;

    play.addEventListener("click", async () => {
      if (!audio.paused) {
        audio.pause();
        return;
      }
      if (activeAudio && activeAudio !== audio) activeAudio.pause();
      activeAudio = audio;
      try {
        await audio.play();
      } catch {
        if (activeAudio === audio) activeAudio = null;
        setState("Не удалось воспроизвести голосовое сообщение.", "error");
      }
    });
    audio.addEventListener("play", () => {
      activeAudio = audio;
      play.textContent = "❚❚";
      play.setAttribute("aria-label", "Приостановить голосовое сообщение");
    });
    audio.addEventListener("pause", () => {
      play.textContent = "▶";
      play.setAttribute("aria-label", "Воспроизвести голосовое сообщение");
      if (activeAudio === audio) activeAudio = null;
    });
    audio.addEventListener("durationchange", () => {
      const duration = Number.isFinite(audio.duration) ? audio.duration : 0;
      progress.max = String(duration);
      progress.disabled = duration <= 0;
      time.textContent = `${formatAudioTime(audio.currentTime)} / ${formatAudioTime(duration)}`;
    });
    audio.addEventListener("timeupdate", () => {
      progress.value = String(audio.currentTime);
      time.textContent = `${formatAudioTime(audio.currentTime)} / ${formatAudioTime(audio.duration)}`;
    });
    audio.addEventListener("ended", () => {
      progress.value = "0";
      play.textContent = "▶";
      play.setAttribute("aria-label", "Воспроизвести голосовое сообщение");
      if (activeAudio === audio) activeAudio = null;
    });
    progress.addEventListener("input", () => {
      audio.currentTime = Number(progress.value);
    });
    player.append(play, progress, time, audio);
    return player;
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
    if (item.sender.nickname === ownNickname) {
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "danger";
      remove.textContent = "Удалить";
      remove.addEventListener("click", () => {
        menu.open = false;
        deleteTransmission(item);
      });
      actions.append(remove);
    }
    menu.append(trigger, actions);
    return menu;
  }

  function renderChannels() {
    channelsElement.replaceChildren();
    for (const item of channels.values()) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = item.speaker && !item.speaker.isSelf ? `${item.title} · в эфире` : item.title;
      button.setAttribute("aria-label", item.kind === "DIRECT" ? `Прямой канал с ${item.title}` : `Канал ${item.title}`);
      button.classList.toggle("active", item.id === channel?.id);
      button.disabled = item.id === channel?.id;
      button.addEventListener("click", () => selectChannel(item));
      channelsElement.append(button);
    }
    help.hidden = channels.size > 0;
  }

  function renderTransmissions(items = []) {
    transmissionsElement.replaceChildren();
    if (!items.length) {
      const empty = document.createElement("p");
      empty.className = "radio-empty";
      empty.textContent = channel ? "В этом канале ещё нет передач." : "Выберите канал рации.";
      transmissionsElement.append(empty);
      return;
    }
    for (const item of items) {
      const article = document.createElement("article");
      article.className = "radio-transmission";
      article.dataset.transmissionId = String(item.id);
      const header = document.createElement("header");
      const author = document.createElement("strong");
      author.textContent = item.sender.nickname;
      const time = document.createElement("time");
      time.dateTime = item.committedAt;
      time.textContent = new Date(item.committedAt).toLocaleString([], { dateStyle: "short", timeStyle: "short" });
      const menu = createTransmissionMenu(item);
      header.append(author, time);
      header.append(menu);
      article.append(header, createAudioPlayer(item));
      transmissionsElement.append(article);
    }
    transmissionsElement.scrollTop = transmissionsElement.scrollHeight;
  }

  async function loadTransmissions({ silent = false } = {}) {
    if (!channel) {
      renderTransmissions();
      return [];
    }
    try {
      const data = await api(`/api/driver/radio/channels/${channel.id}/transmissions?limit=30`);
      const items = data.transmissions || [];
      renderTransmissions(items);
      return items;
    } catch (error) {
      if (error.status === 401) onAuthLost();
      else if (!silent) setState("Не удалось загрузить передачи.", "error");
      return null;
    }
  }

  async function selectChannel(next) {
    if (!next || recording || starting || uploading) return;
    channel = next;
    title.textContent = `Рация: ${next.title}`;
    experience.setChannel(next);
    renderChannels();
    setState("Канал выбран. Зажмите кнопку, чтобы говорить.", "ready");
    updatePtt();
    await loadTransmissions();
  }

  async function refreshChannels() {
    if (!profileReady) return;
    try {
      const data = await api("/api/driver/radio/channels");
      const previousId = channel?.id;
      channels.clear();
      for (const item of data.channels || []) channels.set(item.id, item);
      channel = previousId ? channels.get(previousId) || null : channel;
      renderChannels();
      experience.setChannel(channel);
      updatePtt();
      if (channel?.speaker && !channel.speaker.isSelf) {
        setState(`Сейчас говорит ${channel.speaker.nickname}.`, "listening");
      } else if (!recording && !starting && !uploading && channel && Date.now() >= statusLockUntil) {
        setState("Канал свободен. Можно говорить.", "ready");
      }
    } catch (error) {
      if (error.status === 401) onAuthLost();
      else setState("Не удалось обновить каналы рации.", "error");
    }
  }

  function schedulePoll() {
    if (pollTimer) window.clearInterval(pollTimer);
    pollTimer = activated ? window.setInterval(async () => {
      const lastTransmissionId = channel?.lastTransmissionId;
      const transmissionCount = channel?.transmissionCount;
      await refreshChannels();
      if (channel && (channel.lastTransmissionId !== lastTransmissionId || channel.transmissionCount !== transmissionCount) && !recording) {
        await loadTransmissions();
      }
    }, POLL_MS) : null;
  }

  function closeStream() {
    for (const track of stream?.getTracks?.() || []) track.stop();
    stream = null;
  }

  async function cancelTransmission(session) {
    if (!session) return false;
    try {
      await api(`/api/driver/radio/transmissions/${session.transmissionId}/audio`, {
        method: "DELETE", headers: { "X-Radio-Upload-Token": session.uploadToken }
      });
      return true;
    } catch {
      // If the browser is already offline, the existing server-side lease still expires safely.
      return false;
    }
  }

  async function finishRecording(chunks, mimeType, session) {
    recording = null;
    recordingStartedAt = 0;
    stopRecordingClock();
    uploading = true;
    ptt.classList.remove("recording");
    updatePtt();
    closeStream();

    if (cancelUpload) {
      const message = cancelReason || "Передача отменена.";
      cancelUpload = false;
      cancelReason = "";
      uploading = false;
      await cancelTransmission(session);
      setState(message, message.includes("не отправлена") ? "error" : "ready");
      updatePtt();
      return;
    }

    const blob = new Blob(chunks, { type: mimeType || "audio/webm" });
    if (!blob.size) {
      uploading = false;
      updatePtt();
      await cancelTransmission(session);
      return setState("Пустая запись не отправлена.", "error");
    }
    if (blob.size > MAX_AUDIO_BYTES) {
      uploading = false;
      updatePtt();
      await cancelTransmission(session);
      return setState("Запись больше 3 МиБ и не отправлена.", "error");
    }

    setState("Отправляем передачу. Пока нет подтверждения сервера, она не считается доставленной.", "sending");
    try {
      await uploadBinary(`/api/driver/radio/transmissions/${session.transmissionId}/audio`, blob, {
        headers: { "X-Radio-Upload-Token": session.uploadToken }
      });
      await refreshChannels();
      await loadTransmissions();
      setState("Передача доставлена.", "sent", { lockMs: 2500 });
    } catch (error) {
      if (error.status === 401) {
        onAuthLost();
      } else {
        const items = await loadTransmissions({ silent: true });
        const committed = Array.isArray(items)
          ? items.some((item) => Number(item.id) === Number(session.transmissionId))
          : null;
        if (committed) {
          setState("Передача доставлена. Ответ загрузки был потерян, но передача уже есть в канале.", "sent", { lockMs: 2500 });
        } else if (committed === false) {
          await cancelTransmission(session);
          if (error.message === "radio_upload_not_authorized") {
            setState("Время передачи истекло. Запись не отправлена.", "error");
          } else if (globalThis.navigator?.onLine === false) {
            setState("Нет сети. Передача не отправлена.", "error");
          } else {
            setState("Сервер не подтвердил передачу. Запись не отправлена.", "error");
          }
        } else {
          setState("Не удалось подтвердить доставку. Проверьте канал после восстановления сети.", "error");
        }
      }
    } finally {
      uploading = false;
      updatePtt();
    }
  }

  async function startRecording(event) {
    event?.preventDefault?.();
    if (ptt.disabled || recording || starting || uploading || !channel) return;
    if (!navigator.mediaDevices?.getUserMedia || !globalThis.MediaRecorder) {
      return setState("Этот браузер не поддерживает запись с микрофона.", "error");
    }
    pttHeld = true;
    starting = true;
    cancelUpload = false;
    cancelReason = "";
    if (event?.pointerId !== undefined) ptt.setPointerCapture?.(event.pointerId);
    setState(`Подключаем микрофон для канала «${channel.title}»…`, "requesting");
    updatePtt();
    try {
      stream = await navigator.mediaDevices.getUserMedia(radioAudioConstraints());
      if (!pttHeld) {
        closeStream();
        return;
      }
      const lease = await api(`/api/driver/radio/channels/${channel.id}/ptt`, { method: "POST", body: {} });
      if (!pttHeld) {
        closeStream();
        await cancelTransmission(lease);
        return;
      }
      const mimeType = supportedMimeType();
      recorder = createVoiceRecorder(stream, mimeType);
      const chunks = [];
      const recordedMimeType = recorder.mimeType;
      recording = lease;
      recorder.addEventListener("dataavailable", (item) => { if (item.data?.size) chunks.push(item.data); });
      recorder.addEventListener("stop", () => finishRecording(chunks, recordedMimeType, lease), { once: true });
      recorder.start(1_000);
      recordingStartedAt = Date.now();
      startRecordingClock();
      ptt.classList.add("recording");
      setState(`Вы говорите в канал «${channel.title}».`, "recording");
      updatePtt();
      stopTimer = window.setTimeout(stopRecording, MAX_RECORDING_MS);
    } catch (error) {
      closeStream();
      recording = null;
      recordingStartedAt = 0;
      stopRecordingClock();
      if (error.status === 401) onAuthLost();
      else if (error.message === "radio_channel_busy") setState(error.speaker ? `Сейчас говорит ${error.speaker}.` : "Канал уже занят другим водителем.", "listening");
      else if (error.name === "NotAllowedError") setState("Микрофон запрещён. Разрешите доступ к микрофону в настройках браузера и попробуйте снова.", "error");
      else if (globalThis.navigator?.onLine === false) setState("Нет сети. Передача не начиналась.", "error");
      else setState("Не удалось начать передачу.", "error");
    } finally {
      starting = false;
      updatePtt();
    }
  }

  function stopRecording(event) {
    event?.preventDefault?.();
    const elapsed = recordingStartedAt ? Date.now() - recordingStartedAt : 0;
    pttHeld = false;
    if (stopTimer) window.clearTimeout(stopTimer);
    stopTimer = null;
    if (starting && !recording) {
      cancelUpload = true;
      cancelReason = "Передача отменена до начала записи.";
      setState(cancelReason, "ready");
      return;
    }
    if (recording && isAccidentalRecording(elapsed, MIN_RECORDING_MS)) {
      cancelUpload = true;
      cancelReason = "Слишком короткая запись. Передача не отправлена.";
    }
    if (recorder?.state === "recording") recorder.stop();
  }

  function cancelRecording(event, reason = "Передача отменена.") {
    event?.preventDefault?.();
    if (!pttHeld && !recording && !starting) return;
    cancelUpload = true;
    cancelReason = reason;
    pttHeld = false;
    if (stopTimer) window.clearTimeout(stopTimer);
    stopTimer = null;
    setState("Отменяем передачу…", "requesting");
    if (recorder?.state === "recording") recorder.stop();
  }

  ptt.addEventListener("pointerdown", startRecording);
  ptt.addEventListener("pointerup", stopRecording);
  ptt.addEventListener("pointercancel", (event) => cancelRecording(event, "Передача отменена из-за прерванного касания."));
  ptt.addEventListener("lostpointercapture", (event) => { if (pttHeld) cancelRecording(event); });
  ptt.addEventListener("contextmenu", (event) => event.preventDefault());
  ptt.addEventListener("selectstart", (event) => event.preventDefault());
  ptt.addEventListener("dragstart", (event) => event.preventDefault());
  ptt.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && (recording || starting || pttHeld)) {
      cancelRecording(event);
      return;
    }
    if ((event.key === " " || event.key === "Enter") && !event.repeat) startRecording(event);
  });
  ptt.addEventListener("keyup", (event) => {
    if (event.key === " " || event.key === "Enter") stopRecording(event);
  });
  ptt.addEventListener("blur", (event) => { if (pttHeld) cancelRecording(event, "Передача отменена: кнопка потеряла фокус."); });

  experience.reset();
  updatePtt();

  return {
    async activate() {
      activated = true;
      if (!profileReady) return setState("Сначала сохраните профиль водителя.", "error");
      await refreshChannels();
      if (!channel && channels.size) await selectChannel(channels.values().next().value);
      else if (channel) await loadTransmissions();
      if (!channel && !channels.size) setState("Нет доступного канала рации.", "disabled");
      schedulePoll();
    },
    setSession({ profile }) {
      profileReady = Boolean(profile);
      ownNickname = profile?.nickname || "";
      navButton.disabled = !profileReady;
      updatePtt();
    },
    setProfileReady(profile) {
      profileReady = Boolean(profile);
      ownNickname = profile?.nickname || ownNickname;
      navButton.disabled = !profileReady;
      updatePtt();
    },
    async openDirect(nickname) {
      if (!profileReady) throw new Error("driver_profile_required");
      const data = await api("/api/driver/radio/direct", { method: "POST", body: { nickname } });
      channels.set(data.channel.id, data.channel);
      await selectChannel(data.channel);
    },
    reset() {
      activated = false;
      profileReady = false;
      ownNickname = "";
      pttHeld = false;
      starting = false;
      uploading = false;
      cancelUpload = true;
      cancelReason = "";
      statusLockUntil = 0;
      if (activeAudio) activeAudio.pause();
      activeAudio = null;
      if (pollTimer) window.clearInterval(pollTimer);
      if (stopTimer) window.clearTimeout(stopTimer);
      pollTimer = null;
      stopTimer = null;
      stopRecordingClock();
      if (recorder?.state === "recording") recorder.stop();
      closeStream();
      recorder = null;
      recording = null;
      recordingStartedAt = 0;
      channel = null;
      channels.clear();
      renderChannels();
      renderTransmissions();
      navButton.disabled = true;
      ptt.classList.remove("recording");
      currentPhase = "disabled";
      experience.reset();
      updatePtt();
      setState("Рация отключена", "disabled");
    }
  };
}

export function createDriverModule(context) {
  return createRadioController({ api: context.api, uploadBinary: context.uploadBinary, onAuthLost: context.onAuthLost });
}
