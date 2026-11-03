import { ipcRenderer } from "electron";
import { createCaptureEncoder, createUplink, FLUSH_MS, type CaptureChunk } from "./encoder";

import { isNumber, objectOf } from "~shared/validation";

const isCaptureChunk = objectOf<CaptureChunk>({
  sampleRate: isNumber,
  left: (value): value is Float32Array => value instanceof Float32Array,
  right: (value): value is Float32Array => value instanceof Float32Array,
});

const uplink = createUplink();
const encoder = createCaptureEncoder({
  api: { AudioEncoder, AudioData },
  sendPackets: (packets) => uplink.sendPackets(packets),
  sendStatus: (status) => uplink.sendStatus(status),
});

let input: MessagePort | null = null;

ipcRenderer.on("mediaHost:uplinkPort", (event) => {
  const port = event.ports[0];
  if (port !== undefined) uplink.attach(port);
});

ipcRenderer.on("mediaHost:capturePort", (event) => {
  input?.close();
  input = event.ports[0] ?? null;
  if (input === null) return;
  input.onmessage = (message: MessageEvent<unknown>) => {
    if (!isCaptureChunk(message.data)) throw new TypeError("Invalid audio capture chunk");
    encoder.push(message.data);
  };
});

setInterval(() => encoder.flush(), FLUSH_MS);
