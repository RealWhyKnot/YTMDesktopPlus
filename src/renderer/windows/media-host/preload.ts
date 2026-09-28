import { ipcRenderer } from "electron";
import { createCaptureEncoder, createUplink, FLUSH_MS } from "./encoder";

const uplink = createUplink();
const encoder = createCaptureEncoder({
  api: { AudioEncoder, AudioData },
  sendPackets: uplink.sendPackets,
  sendStatus: uplink.sendStatus
});

let input: MessagePort | null = null;

ipcRenderer.on("mediaHost:uplinkPort", event => uplink.attach(event.ports[0]));

ipcRenderer.on("mediaHost:capturePort", event => {
  input?.close();
  input = event.ports[0];
  input.onmessage = message => encoder.push(message.data);
});

setInterval(() => encoder.flush(), FLUSH_MS);
