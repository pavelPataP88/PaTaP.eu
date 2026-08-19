const MAX_VOICE_MS = 5 * 60 * 1000;

export function attachmentKind(file) {
  const mime = String(file?.type || "").toLowerCase();
  if (/^image\/(jpeg|png|webp|gif)$/.test(mime)) return "IMAGE";
  if (/^video\/(mp4|webm|quicktime)$/.test(mime)) return "VIDEO";
  if (/^audio\/(webm|ogg|mp4|mpeg|wav|x-wav)$/.test(mime)) return "AUDIO";
  return "FILE";
}

export function formatBytes(value) {
  const bytes = Math.max(0, Number(value) || 0);
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} КБ`;
  return `${(bytes / 1024 ** 2).toFixed(bytes < 10 * 1024 ** 2 ? 1 : 0)} МБ`;
}

export function formatDuration(milliseconds) {
  const total = Math.floor(Math.max(0, Number(milliseconds) || 0) / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function preferredMimeType() {
  for (const mime of ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"]) {
    if (globalThis.MediaRecorder?.isTypeSupported?.(mime)) return mime;
  }
  return "";
}

export function createVoiceRecorder({ onState = () => {}, onTick = () => {}, maxDurationMs = MAX_VOICE_MS } = {}) {
  let stream = null;
  let recorder = null;
  let chunks = [];
  let startedAt = 0;
  let pausedAt = 0;
  let pausedTotal = 0;
  let ticker = null;
  let maxTimer = null;
  let stopping = false;
  let cancelled = false;

  function elapsed() {
    if (!startedAt) return 0;
    const end = pausedAt || Date.now();
    return Math.max(0, end - startedAt - pausedTotal);
  }

  function stopTracks() {
    for (const track of stream?.getTracks?.() || []) track.stop();
    stream = null;
  }

  function clearTimers() {
    if (ticker) window.clearInterval(ticker);
    if (maxTimer) window.clearTimeout(maxTimer);
    ticker = null;
    maxTimer = null;
  }

  async function start() {
    if (recorder && recorder.state !== "inactive") return false;
    if (!navigator.mediaDevices?.getUserMedia || !globalThis.MediaRecorder) throw new Error("voice_recording_unavailable");
    cancelled = false;
    stopping = false;
    chunks = [];
    stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    const mimeType = preferredMimeType();
    recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
    recorder.addEventListener("dataavailable", (event) => { if (event.data?.size) chunks.push(event.data); });
    recorder.addEventListener("error", () => onState("error"));
    startedAt = Date.now(); pausedAt = 0; pausedTotal = 0;
    recorder.start(1000);
    ticker = window.setInterval(() => onTick(elapsed()), 250);
    maxTimer = window.setTimeout(() => { if (recorder?.state !== "inactive") stop().catch(() => {}); }, maxDurationMs);
    onState("recording"); onTick(0); return true;
  }

  function pause() {
    if (recorder?.state !== "recording") return false;
    recorder.pause(); pausedAt = Date.now(); onState("paused"); return true;
  }

  function resume() {
    if (recorder?.state !== "paused") return false;
    pausedTotal += Date.now() - pausedAt; pausedAt = 0; recorder.resume(); onState("recording"); return true;
  }

  async function stop() {
    if (!recorder || recorder.state === "inactive" || stopping) return null;
    stopping = true;
    const durationMs = elapsed();
    return new Promise((resolve, reject) => {
      const current = recorder;
      const done = () => {
        clearTimers();
        const blob = cancelled ? null : new Blob(chunks, { type: current.mimeType || chunks[0]?.type || "audio/webm" });
        stopTracks(); recorder = null; chunks = []; startedAt = 0; pausedAt = 0; pausedTotal = 0; stopping = false;
        onState(cancelled ? "cancelled" : "ready");
        resolve(blob ? { blob, durationMs, fileName: `voice-${Date.now()}.${blob.type.includes("ogg") ? "ogg" : blob.type.includes("mp4") ? "m4a" : "webm"}` } : null);
      };
      current.addEventListener("stop", done, { once: true });
      current.addEventListener("error", (event) => { clearTimers(); stopTracks(); recorder = null; stopping = false; reject(event.error || new Error("voice_recording_failed")); }, { once: true });
      try { current.stop(); } catch (error) { reject(error); }
    });
  }

  async function cancel() {
    cancelled = true;
    if (!recorder || recorder.state === "inactive") { clearTimers(); stopTracks(); recorder = null; chunks = []; onState("cancelled"); return null; }
    return stop();
  }

  return {
    start, pause, resume, stop, cancel, elapsed,
    isRecording: () => recorder?.state === "recording",
    isPaused: () => recorder?.state === "paused",
    isActive: () => Boolean(recorder && recorder.state !== "inactive")
  };
}

export const CHAT_MAX_VOICE_MS = MAX_VOICE_MS;
