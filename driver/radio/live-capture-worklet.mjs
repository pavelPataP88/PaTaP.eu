// AudioWorklet runs on the audio rendering thread and forwards raw mono float samples
// to the main thread. Downsampling and network framing remain in live-audio.mjs so
// the existing 16 kHz PCM transport contract stays unchanged.
class PatapRadioCaptureProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const input = inputs?.[0]?.[0];
    if (input?.length) {
      const copy = new Float32Array(input);
      this.port.postMessage(copy, [copy.buffer]);
    }
    return true;
  }
}

registerProcessor("patap-radio-capture-v1", PatapRadioCaptureProcessor);
