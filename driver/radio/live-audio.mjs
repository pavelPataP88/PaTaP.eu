const TARGET_SAMPLE_RATE = 16_000;
const LIVE_CHUNK_SAMPLES = 4_000; // ~250 ms at 16 kHz.
const LIVE_UPLOAD_TIMEOUT_MS = 4_000;
const MAX_SCHEDULE_AHEAD_SECONDS = 1.5;

function audioContextCtor() {
  return globalThis.AudioContext || globalThis.webkitAudioContext || null;
}

function pcm16(value) {
  const sample = Math.max(-1, Math.min(1, Number(value) || 0));
  return sample < 0 ? Math.round(sample * 0x8000) : Math.round(sample * 0x7fff);
}

export function createPcmDownsampler(inputRate, targetRate = TARGET_SAMPLE_RATE) {
  const safeInputRate = Math.max(1, Number(inputRate) || targetRate);
  const safeTargetRate = Math.min(safeInputRate, Math.max(1, Number(targetRate) || TARGET_SAMPLE_RATE));
  const ratio = safeInputRate / safeTargetRate;
  let carry = new Float32Array(0);
  let position = 0;

  return {
    sampleRate: safeTargetRate,
    push(input) {
      const incoming = input instanceof Float32Array ? input : Float32Array.from(input || []);
      if (!incoming.length) return new Int16Array(0);
      const combined = new Float32Array(carry.length + incoming.length);
      combined.set(carry, 0);
      combined.set(incoming, carry.length);
      const output = [];
      while (position < combined.length - 1) {
        const left = Math.floor(position);
        const fraction = position - left;
        const sample = combined[left] + (combined[left + 1] - combined[left]) * fraction;
        output.push(pcm16(sample));
        position += ratio;
      }
      const consumed = Math.min(combined.length, Math.floor(position));
      carry = combined.slice(consumed);
      position -= consumed;
      return Int16Array.from(output);
    }
  };
}

export function pcm16ToLittleEndianBlob(samples) {
  const input = samples instanceof Int16Array ? samples : Int16Array.from(samples || []);
  const bytes = new Uint8Array(input.length * 2);
  const view = new DataView(bytes.buffer);
  for (let index = 0; index < input.length; index += 1) view.setInt16(index * 2, input[index], true);
  return new Blob([bytes], { type: "application/octet-stream" });
}

export function decodePcm16Base64(encoded) {
  const binary = globalThis.atob?.(String(encoded || "")) || "";
  const length = Math.floor(binary.length / 2);
  const bytes = new Uint8Array(length * 2);
  for (let index = 0; index < bytes.length; index += 1) bytes[index] = binary.charCodeAt(index);
  const view = new DataView(bytes.buffer);
  const output = new Float32Array(length);
  for (let index = 0; index < length; index += 1) {
    const value = view.getInt16(index * 2, true);
    output[index] = value < 0 ? value / 0x8000 : value / 0x7fff;
  }
  return output;
}

export function createRadioLiveAudio({ uploadBinary, canListenToChannel = () => true, onTransportState = () => {} } = {}) {
  let broadcaster = null;
  let broadcastGeneration = 0;
  let listenContext = null;
  const listenStreams = new Map();
  const completedLiveTransmissions = new Set();

  async function unlockListening() {
    const Ctor = audioContextCtor();
    if (!Ctor) return false;
    if (!listenContext || listenContext.state === "closed") listenContext = new Ctor({ latencyHint: "interactive" });
    try {
      if (listenContext.state !== "running") await listenContext.resume();
      return listenContext.state === "running";
    } catch {
      return false;
    }
  }

  async function stopBroadcast({ flush = true } = {}) {
    broadcastGeneration += 1;
    const active = broadcaster;
    broadcaster = null;
    if (active) await active.stop({ flush });
  }

  async function startBroadcast(stream, session) {
    await stopBroadcast({ flush: false });
    const generation = ++broadcastGeneration;
    const Ctor = audioContextCtor();
    if (!Ctor || !stream || !session?.transmissionId || !session?.uploadToken) return false;
    let context;
    try {
      context = new Ctor({ latencyHint: "interactive" });
      if (context.state !== "running") await context.resume();
      if (generation !== broadcastGeneration) {
        await context.close().catch(() => {});
        return false;
      }
      if (context.state !== "running" || typeof context.createScriptProcessor !== "function") {
        await context.close().catch(() => {});
        return false;
      }
    } catch {
      await context?.close?.().catch(() => {});
      return false;
    }

    const source = context.createMediaStreamSource(stream);
    const processor = context.createScriptProcessor(2048, 1, 1);
    const silentGain = context.createGain();
    silentGain.gain.value = 0;
    source.connect(processor);
    processor.connect(silentGain);
    silentGain.connect(context.destination);

    const downsampler = createPcmDownsampler(context.sampleRate, TARGET_SAMPLE_RATE);
    let samples = [];
    let sequence = 0;
    let transportFailed = false;
    let captureStopped = false;
    let cancelled = false;
    let sendChain = Promise.resolve();

    function queueChunk(chunk) {
      if (!chunk.length || cancelled || transportFailed) return;
      const currentSequence = sequence;
      sequence += 1;
      const blob = pcm16ToLittleEndianBlob(chunk);
      sendChain = sendChain.then(async () => {
        if (cancelled || transportFailed) return;
        try {
          await uploadBinary(`/api/driver/radio/live/${session.transmissionId}`, blob, {
            timeoutMs: LIVE_UPLOAD_TIMEOUT_MS,
            headers: {
              "X-Radio-Upload-Token": session.uploadToken,
              "X-Radio-Live-Sequence": String(currentSequence),
              "X-Radio-Live-Sample-Rate": String(downsampler.sampleRate)
            }
          });
          onTransportState("live");
        } catch {
          transportFailed = true;
          onTransportState("history_only");
        }
      });
    }

    function drainFullChunks() {
      while (samples.length >= LIVE_CHUNK_SAMPLES) {
        const chunk = Int16Array.from(samples.slice(0, LIVE_CHUNK_SAMPLES));
        samples = samples.slice(LIVE_CHUNK_SAMPLES);
        queueChunk(chunk);
      }
    }

    processor.onaudioprocess = (event) => {
      if (captureStopped || cancelled || transportFailed) return;
      const input = event.inputBuffer?.getChannelData?.(0);
      if (!input?.length) return;
      const converted = downsampler.push(input);
      for (const value of converted) samples.push(value);
      drainFullChunks();
    };

    broadcaster = {
      context, source, processor, silentGain,
      async stop({ flush = true } = {}) {
        if (captureStopped) return;
        processor.onaudioprocess = null;
        if (flush && samples.length && !transportFailed) queueChunk(Int16Array.from(samples));
        samples = [];
        captureStopped = true;
        if (!flush) cancelled = true;
        try { source.disconnect(); } catch {}
        try { processor.disconnect(); } catch {}
        try { silentGain.disconnect(); } catch {}
        await context.close().catch(() => {});
        await Promise.race([
          sendChain.catch(() => {}),
          new Promise((resolve) => setTimeout(resolve, LIVE_UPLOAD_TIMEOUT_MS))
        ]);
        if (flush && !cancelled && !transportFailed && sequence > 0) {
          try {
            await uploadBinary(`/api/driver/radio/live/${session.transmissionId}`, new Blob([], { type: "application/octet-stream" }), {
              timeoutMs: LIVE_UPLOAD_TIMEOUT_MS,
              headers: {
                "X-Radio-Upload-Token": session.uploadToken,
                "X-Radio-Live-End": "1",
                "X-Radio-Live-Sequence": String(sequence - 1)
              }
            });
          } catch {
            onTransportState("history_only");
          }
        }
      }
    };
    onTransportState("live");
    return true;
  }

  async function handleIncoming(payload) {
    const channelId = Number(payload?.channelId);
    const transmissionId = Number(payload?.transmissionId);
    if (!Number.isSafeInteger(channelId) || !Number.isSafeInteger(transmissionId)) return false;
    if (!canListenToChannel(channelId)) return false;

    if (payload?.end === true) {
      const finalSequence = Number(payload.finalSequence);
      const streamState = listenStreams.get(transmissionId);
      if (streamState && streamState.complete && Number.isSafeInteger(finalSequence) && finalSequence === streamState.lastSequence) {
        completedLiveTransmissions.add(transmissionId);
        if (completedLiveTransmissions.size > 200) completedLiveTransmissions.delete(completedLiveTransmissions.values().next().value);
      }
      listenStreams.delete(transmissionId);
      return true;
    }

    const sequence = Number(payload?.sequence);
    const sampleRate = Number(payload?.sampleRate);
    if (!Number.isSafeInteger(sequence) || sequence < 0 || sampleRate !== TARGET_SAMPLE_RATE) return false;
    if (!(await unlockListening())) return false;
    const samples = decodePcm16Base64(payload.audio);
    if (!samples.length) return false;

    let streamState = listenStreams.get(transmissionId);
    if (!streamState) streamState = { lastSequence: -1, nextTime: listenContext.currentTime + 0.08, complete: true };
    if (sequence <= streamState.lastSequence) return false;
    if (sequence !== streamState.lastSequence + 1) {
      streamState.complete = false;
      streamState.nextTime = listenContext.currentTime + 0.08;
    } else if (streamState.nextTime - listenContext.currentTime > MAX_SCHEDULE_AHEAD_SECONDS) {
      streamState.complete = false;
      streamState.nextTime = listenContext.currentTime + 0.08;
    }

    const buffer = listenContext.createBuffer(1, samples.length, sampleRate);
    buffer.copyToChannel(samples, 0);
    const source = listenContext.createBufferSource();
    source.buffer = buffer;
    source.connect(listenContext.destination);
    const startAt = Math.max(listenContext.currentTime + 0.04, streamState.nextTime);
    source.start(startAt);
    streamState.nextTime = startAt + buffer.duration;
    streamState.lastSequence = sequence;
    listenStreams.set(transmissionId, streamState);
    source.addEventListener("ended", () => { try { source.disconnect(); } catch {} }, { once: true });
    return true;
  }

  function hasHeard(transmissionId) {
    return completedLiveTransmissions.has(Number(transmissionId));
  }

  function closeListening() {
    listenStreams.clear();
    completedLiveTransmissions.clear();
    const context = listenContext;
    listenContext = null;
    context?.close?.().catch(() => {});
  }

  return {
    unlockListening,
    startBroadcast,
    stopBroadcast,
    handleIncoming,
    hasHeard,
    closeListening,
    isListeningUnlocked() { return listenContext?.state === "running"; }
  };
}

export const RADIO_LIVE_SAMPLE_RATE = TARGET_SAMPLE_RATE;
export const RADIO_LIVE_CHUNK_SAMPLES = LIVE_CHUNK_SAMPLES;
