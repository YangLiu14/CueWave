class CueWavePcmProcessor extends AudioWorkletProcessor {
  constructor() {
    super(); this.phase = 0; this.sum = 0; this.count = 0; this.samples = []; this.chunkSamples = 1600;
  }
  process(inputs) {
    const channels = inputs[0];
    if (!channels?.length) return true;
    const input = channels[0];
    for (let i = 0; i < input.length; i++) {
      this.sum += input[i]; this.count++;
      this.phase += 16000 / sampleRate;
      if (this.phase < 1) continue;
      this.phase -= 1;
      this.samples.push(Math.max(-1, Math.min(1, this.sum / this.count)));
      this.sum = 0; this.count = 0;
      if (this.samples.length === this.chunkSamples) {
        const pcm = new Int16Array(this.chunkSamples);
        for (let j = 0; j < pcm.length; j++) pcm[j] = Math.round(this.samples[j] * 32767);
        this.port.postMessage(pcm.buffer, [pcm.buffer]);
        this.samples = [];
      }
    }
    return true;
  }
}
registerProcessor("cuewave-pcm", CueWavePcmProcessor);
