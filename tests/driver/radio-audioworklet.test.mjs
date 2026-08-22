import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  createRadioCaptureGraph,
  RADIO_CAPTURE_WORKLET_NAME,
  RADIO_CAPTURE_WORKLET_URL
} from "../../driver/radio/capture-graph.mjs";

const workletSource = await readFile(new URL("../../driver/radio/live-capture-worklet.mjs", import.meta.url), "utf8");
const liveAudioSource = await readFile(new URL("../../driver/radio/live-audio.mjs", import.meta.url), "utf8");

function nodeStub() {
  return {
    connectedTo: null,
    disconnected: false,
    connect(target) { this.connectedTo = target; return target; },
    disconnect() { this.disconnected = true; }
  };
}

function contextStub({ addModule, createScriptProcessor } = {}) {
  const source = nodeStub();
  const gain = nodeStub();
  gain.gain = { value: 1 };
  const destination = { id: "destination" };
  return {
    sampleRate: 48_000,
    destination,
    source,
    gain,
    audioWorklet: addModule ? { addModule } : undefined,
    createMediaStreamSource() { return source; },
    createGain() { return gain; },
    ...(createScriptProcessor ? { createScriptProcessor } : {})
  };
}

test("radio capture prefers AudioWorklet and never touches ScriptProcessor when worklet setup succeeds", async () => {
  const previous = globalThis.AudioWorkletNode;
  const modules = [];
  const captured = [];
  let fallbackCalls = 0;
  class FakeWorkletNode {
    constructor(context, name, options) {
      this.context = context;
      this.name = name;
      this.options = options;
      this.port = { onmessage: null };
      this.connectedTo = null;
      this.disconnected = false;
    }
    connect(target) { this.connectedTo = target; return target; }
    disconnect() { this.disconnected = true; }
  }
  globalThis.AudioWorkletNode = FakeWorkletNode;
  try {
    const context = contextStub({
      addModule: async (url) => modules.push(url),
      createScriptProcessor() { fallbackCalls += 1; throw new Error("fallback_must_not_run"); }
    });
    const graph = await createRadioCaptureGraph({
      context,
      stream: { id: "mic" },
      onSamples: (samples) => captured.push([...samples])
    });

    assert.ok(graph);
    assert.equal(graph.mode, "audioworklet");
    assert.equal(fallbackCalls, 0);
    assert.deepEqual(modules, [RADIO_CAPTURE_WORKLET_URL]);
    assert.equal(graph.processor.name, RADIO_CAPTURE_WORKLET_NAME);
    assert.equal(graph.processor.options.channelCount, 1);
    assert.equal(context.gain.gain.value, 0);
    assert.equal(context.source.connectedTo, graph.processor);
    assert.equal(graph.processor.connectedTo, context.gain);
    assert.equal(context.gain.connectedTo, context.destination);

    graph.processor.port.onmessage({ data: Float32Array.from([0.25, -0.5]) });
    assert.deepEqual(captured, [[0.25, -0.5]]);
    graph.stop();
    assert.equal(graph.processor.port.onmessage, null);
    assert.equal(context.source.disconnected, true);
    assert.equal(graph.processor.disconnected, true);
    assert.equal(context.gain.disconnected, true);
  } finally {
    if (previous === undefined) delete globalThis.AudioWorkletNode;
    else globalThis.AudioWorkletNode = previous;
  }
});

test("radio capture has an explicit ScriptProcessor fallback when AudioWorklet cannot load", async () => {
  const previous = globalThis.AudioWorkletNode;
  class FakeWorkletNode {}
  globalThis.AudioWorkletNode = FakeWorkletNode;
  try {
    const processor = nodeStub();
    processor.onaudioprocess = null;
    const context = contextStub({
      addModule: async () => { throw new Error("worklet_unavailable"); },
      createScriptProcessor(size, inputChannels, outputChannels) {
        assert.equal(size, 2048);
        assert.equal(inputChannels, 1);
        assert.equal(outputChannels, 1);
        return processor;
      }
    });
    const captured = [];
    const graph = await createRadioCaptureGraph({ context, stream: {}, onSamples: (samples) => captured.push([...samples]) });

    assert.ok(graph);
    assert.equal(graph.mode, "scriptprocessor-fallback");
    processor.onaudioprocess({ inputBuffer: { getChannelData: () => Float32Array.from([0.1, 0.2]) } });
    assert.equal(captured.length, 1);
    assert.ok(Math.abs(captured[0][0] - 0.1) < 1e-6);
    assert.ok(Math.abs(captured[0][1] - 0.2) < 1e-6);
    graph.stop();
    assert.equal(processor.onaudioprocess, null);
  } finally {
    if (previous === undefined) delete globalThis.AudioWorkletNode;
    else globalThis.AudioWorkletNode = previous;
  }
});

test("radio capture fails closed when neither AudioWorklet nor legacy fallback exists", async () => {
  const previous = globalThis.AudioWorkletNode;
  delete globalThis.AudioWorkletNode;
  try {
    const context = contextStub();
    const graph = await createRadioCaptureGraph({ context, stream: {} });
    assert.equal(graph, null);
    assert.equal(context.source.disconnected, true);
  } finally {
    if (previous !== undefined) globalThis.AudioWorkletNode = previous;
  }
});

test("AudioWorklet processor is static same-origin code and live radio preserves the existing transport contract", () => {
  assert.equal(RADIO_CAPTURE_WORKLET_NAME, "patap-radio-capture-v1");
  assert.match(RADIO_CAPTURE_WORKLET_URL, /live-capture-worklet\.mjs\?v=20260822-aud024-1$/);
  assert.match(workletSource, /extends AudioWorkletProcessor/);
  assert.match(workletSource, /registerProcessor\("patap-radio-capture-v1"/);
  assert.match(workletSource, /postMessage\(copy, \[copy\.buffer\]\)/);
  assert.doesNotMatch(workletSource, /fetch\(|XMLHttpRequest|WebSocket|EventSource/);

  assert.match(liveAudioSource, /createRadioCaptureGraph/);
  assert.doesNotMatch(liveAudioSource, /\.createScriptProcessor\(/);
  assert.match(liveAudioSource, /TARGET_SAMPLE_RATE = 16_000/);
  assert.match(liveAudioSource, /LIVE_CHUNK_SAMPLES = 4_000/);
  assert.match(liveAudioSource, /LIVE_GATE_MS = 550/);
  assert.match(liveAudioSource, /X-Radio-Live-Sample-Rate/);
  assert.match(liveAudioSource, /X-Radio-Live-End/);
});
