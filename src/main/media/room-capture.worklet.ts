const CHUNK_FRAMES = 1024;
const QUANTUM_FRAMES = 128;

class RoomCapture extends AudioWorkletProcessor {
  private out: { postMessage(message: unknown): void; close(): void } | null;
  private isStopped: boolean;
  private isAd: boolean;
  private left: Float32Array;
  private right: Float32Array;
  private filled: number;

  constructor() {
    super();
    this.out = null;
    this.isStopped = false;
    this.isAd = false;
    this.left = new Float32Array(CHUNK_FRAMES);
    this.right = new Float32Array(CHUNK_FRAMES);
    this.filled = 0;
    this.port.onmessage = (event: MessageEvent<unknown>) => {
      const data = event.data;
      if (typeof data !== "object" || data === null) return;
      if ("port" in data && this.isOutput(data.port)) this.out = data.port;
      if ("ad" in data && typeof data.ad === "boolean") this.isAd = data.ad;
      if ("stop" in data && data.stop) {
        this.isStopped = true;
        if (this.out) this.out.close();
        this.out = null;
      }
    };
  }

  private isOutput(value: unknown): value is { postMessage(message: unknown): void; close(): void } {
    return (
      typeof value === "object" &&
      value !== null &&
      "postMessage" in value &&
      typeof value.postMessage === "function" &&
      "close" in value &&
      typeof value.close === "function"
    );
  }

  override process(inputs: Float32Array[][]) {
    if (this.isStopped) return false;
    if (this.isAd) return true;
    const input = inputs[0];
    const left = input?.[0];
    const right = input?.[1] ?? left;
    const frames = left ? left.length : QUANTUM_FRAMES;
    for (let offset = 0; offset < frames;) {
      const take = Math.min(frames - offset, CHUNK_FRAMES - this.filled);
      if (left && right) {
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
