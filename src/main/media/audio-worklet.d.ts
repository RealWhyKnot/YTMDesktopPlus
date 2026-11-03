declare const sampleRate: number;
declare const AudioWorkletProcessor: new () => {
  port: MessagePort;
  process(inputs: Float32Array[][]): boolean;
};
declare function registerProcessor(name: string, processor: typeof AudioWorkletProcessor): void;
