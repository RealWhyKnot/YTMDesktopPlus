const CHUNK_FRAMES = 1024;
const QUANTUM_FRAMES = 128;

class RoomCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.out = null;
    this.stopped = false;
    this.ad = false;
    this.left = new Float32Array(CHUNK_FRAMES);
    this.right = new Float32Array(CHUNK_FRAMES);
    this.filled = 0;
    this.port.onmessage = event => {
      if (event.data && event.data.port) this.out = event.data.port;
      if (event.data && typeof event.data.ad === "boolean") this.ad = event.data.ad;
      if (event.data && event.data.stop) {
        this.stopped = true;
        if (this.out) this.out.close();
        this.out = null;
      }
    };
  }

  process(inputs) {
    if (this.stopped) return false;
    if (this.ad) return true;
    const input = inputs[0];
    const left = input[0];
    const right = input[1] || input[0];
    const frames = left ? left.length : QUANTUM_FRAMES;
    for (let offset = 0; offset < frames; ) {
      const take = Math.min(frames - offset, CHUNK_FRAMES - this.filled);
      if (left) {
        this.left.set(left.subarray(offset, offset + take), this.filled);
        this.right.set(right.subarray(offset, offset + take), this.filled);
      } else {
        this.left.fill(0, this.filled, this.filled + take);
        this.right.fill(0, this.filled, this.filled + take);
      }
      this.filled += take;
      offset += take;
      if (this.filled === CHUNK_FRAMES) {
        if (this.out) this.out.postMessage({ sampleRate, left: this.left, right: this.right });
        this.filled = 0;
      }
    }
    return true;
  }
}

registerProcessor("ytmd-room-capture", RoomCapture);
