export const RADIO_CAPTURE_WORKLET_NAME = "patap-radio-capture-v1";
export const RADIO_CAPTURE_WORKLET_URL = new URL("./live-capture-worklet.mjs?v=20260822-aud024-1", import.meta.url).href;

function disconnect(node) {
  try { node?.disconnect?.(); } catch {}
}

function normalizeSamples(value) {
  if (value instanceof Float32Array) return value;
  if (value?.buffer instanceof ArrayBuffer) {
    try { return new Float32Array(value.buffer, value.byteOffset || 0, value.byteLength / Float32Array.BYTES_PER_ELEMENT); }
    catch {}
  }
  try { return Float32Array.from(value || []); }
  catch { return new Float32Array(0); }
}

export async function createRadioCaptureGraph({ context, stream, onSamples = () => {} } = {}) {
  if (!context || !stream || typeof context.createMediaStreamSource !== "function" || typeof context.createGain !== "function") return null;

  const source = context.createMediaStreamSource(stream);
  const silentGain = context.createGain();
  silentGain.gain.value = 0;
  let processor = null;
  let mode = null;

  const WorkletNode = globalThis.AudioWorkletNode;
  if (context.audioWorklet?.addModule && typeof WorkletNode === "function") {
    try {
      await context.audioWorklet.addModule(RADIO_CAPTURE_WORKLET_URL);
      processor = new WorkletNode(context, RADIO_CAPTURE_WORKLET_NAME, {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [1],
        channelCount: 1,
        channelCountMode: "explicit"
      });
      processor.port.onmessage = (event) => {
        const samples = normalizeSamples(event?.data);
        if (samples.length) onSamples(samples);
      };
      mode = "audioworklet";
    } catch {
      processor = null;
    }
  }

  if (!processor && typeof context.createScriptProcessor === "function") {
    try {
      processor = context.createScriptProcessor(2048, 1, 1);
      processor.onaudioprocess = (event) => {
        const samples = event?.inputBuffer?.getChannelData?.(0);
        if (samples?.length) onSamples(samples);
      };
      mode = "scriptprocessor-fallback";
    } catch {
      processor = null;
    }
  }

  if (!processor) {
    disconnect(source);
    disconnect(silentGain);
    return null;
  }

  try {
    source.connect(processor);
    processor.connect(silentGain);
    silentGain.connect(context.destination);
  } catch {
    if (processor.port) processor.port.onmessage = null;
    if ("onaudioprocess" in processor) processor.onaudioprocess = null;
    disconnect(source);
    disconnect(processor);
    disconnect(silentGain);
    return null;
  }

  let stopped = false;
  return {
    mode,
    source,
    processor,
    silentGain,
    stop() {
      if (stopped) return;
      stopped = true;
      if (processor.port) processor.port.onmessage = null;
      if ("onaudioprocess" in processor) processor.onaudioprocess = null;
      disconnect(source);
      disconnect(processor);
      disconnect(silentGain);
    }
  };
}
