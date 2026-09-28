import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("src/main/media/room-capture.worklet.js", "utf8");

type Processor = {
  port: { onmessage: (event: { data: unknown }) => void };
  process(inputs: Float32Array[][]): boolean;
};

function load() {
  const registered: Record<string, new () => Processor> = {};
  class AudioWorkletProcessor {
    port: { onmessage: (event: { data: unknown }) => void } = { onmessage: () => undefined };
  }
  new Function("AudioWorkletProcessor", "registerProcessor", "sampleRate", source)(
    AudioWorkletProcessor,
    (name: string, processor: new () => Processor) => {
      registered[name] = processor;
    },
    48000
  );
  const processor = new registered["ytmd-room-capture"]();
  const sent: { sampleRate: number; left: Float32Array; right: Float32Array }[] = [];
  const out = {
    closed: false,
    postMessage: (message: { sampleRate: number; left: Float32Array; right: Float32Array }) =>
      sent.push({ sampleRate: message.sampleRate, left: message.left.slice(), right: message.right.slice() }),
    close() {
      out.closed = true;
    }
  };
  return { processor, sent, out, connect: () => processor.port.onmessage({ data: { port: out } }) };
}

const quantum = (value: number, frames = 128) => new Float32Array(frames).fill(value);

describe("room capture worklet", () => {
  it("sends a chunk of 1024 stereo frames every eight render quanta", () => {
    const { processor, sent, connect } = load();
    connect();

    for (let i = 0; i < 16; i++) processor.process([[quantum(i), quantum(-i)]]);

    expect(sent).toHaveLength(2);
    expect(sent[0].sampleRate).toBe(48000);
    expect(sent[0].left.length).toBe(1024);
    expect(sent[0].left[0]).toBe(0);
    expect(sent[0].left[1023]).toBe(7);
    expect(sent[1].right[0]).toBe(-8);
  });

  it("copies a mono input to both channels and fills a silent input with zeros", () => {
    const { processor, sent, connect } = load();
    connect();

    for (let i = 0; i < 4; i++) processor.process([[quantum(0.5)]]);
    for (let i = 0; i < 4; i++) processor.process([[]]);

    expect(sent[0].right.slice(0, 512)).toEqual(quantum(0.5, 512));
    expect(sent[0].left.slice(512)).toEqual(new Float32Array(512));
  });

  it("carries frames across chunk boundaries when the quantum does not divide the chunk", () => {
    const { processor, sent, connect } = load();
    connect();

    for (let i = 0; i < 5; i++) processor.process([[quantum(i + 1, 300)]]);

    expect(sent).toHaveLength(1);
    expect(sent[0].left[899]).toBe(3);
    expect(sent[0].left[900]).toBe(4);
    expect(sent[0].left[1023]).toBe(4);
  });

  it("emits nothing while an ad plays and carries on with the music after it", () => {
    const { processor, sent, connect } = load();
    connect();

    for (let i = 0; i < 4; i++) processor.process([[quantum(1)]]);
    processor.port.onmessage({ data: { ad: true } });
    for (let i = 0; i < 16; i++) processor.process([[quantum(9)]]);
    expect(sent).toHaveLength(0);

    processor.port.onmessage({ data: { ad: false } });
    for (let i = 0; i < 4; i++) processor.process([[quantum(2)]]);

    expect(sent).toHaveLength(1);
    expect(sent[0].left.slice(0, 512)).toEqual(quantum(1, 512));
    expect(sent[0].left.slice(512)).toEqual(quantum(2, 512));
  });

  it("starts gated when its channel arrives during an ad", () => {
    const { processor, sent, out } = load();

    processor.port.onmessage({ data: { port: out, ad: true } });
    for (let i = 0; i < 8; i++) processor.process([[quantum(9)]]);
    expect(sent).toHaveLength(0);

    processor.port.onmessage({ data: { ad: false } });
    for (let i = 0; i < 8; i++) processor.process([[quantum(1)]]);
    expect(sent).toHaveLength(1);
    expect(sent[0].left).toEqual(quantum(1, 1024));
  });

  it("drops audio until its channel arrives, then stops for good when told to", () => {
    const { processor, sent, out, connect } = load();

    for (let i = 0; i < 8; i++) processor.process([[quantum(1)]]);
    expect(sent).toHaveLength(0);

    connect();
    processor.port.onmessage({ data: { stop: true } });

    expect(out.closed).toBe(true);
    expect(processor.process([[quantum(1)]])).toBe(false);
  });
});
