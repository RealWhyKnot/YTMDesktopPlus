import { ipcRenderer } from "electron";
import { createCaptureEncoder, FLUSH_MS } from "./encoder";

const encoder = createCaptureEncoder({
  api: { AudioEncoder, AudioData },
  sendPackets: packets => ipcRenderer.send("mediaHost:audioChunks", packets),
  sendStatus: status => ipcRenderer.send("mediaHost:captureStatus", status)
});

let input: MessagePort | null = null;

ipcRenderer.on("mediaHost:capturePort", event => {
  input?.close();
  input = event.ports[0];
  input.onmessage = message => encoder.push(message.data);
});

setInterval(() => encoder.flush(), FLUSH_MS);
