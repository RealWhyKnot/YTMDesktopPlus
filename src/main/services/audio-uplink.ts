import type { BatchPacket } from "~shared/audio-protocol";
import {
  AudioPublisher,
  AudioRelayClient,
  type AudioCaptureStatus,
  type AudioCredentials,
  type AudioPublisherDeps,
  type UplinkState
} from "../integrations/listen-along/audio-publisher";

export type UplinkCommand =
  { t: "creds"; creds: AudioCredentials | null } | { t: "state"; state: UplinkState } | { t: "status"; status: AudioCaptureStatus } | { t: "port" };

export type UplinkEvent =
  { t: "capture"; on: boolean } | { t: "update"; streaming: boolean; webListeners: number } | { t: "log"; message: string; args: string[] };

export type MediaPort = {
  on(event: "message", listener: (event: { data: unknown }) => void): unknown;
  start(): void;
  close(): void;
};

export type ParentPort = {
  on(event: "message", listener: (event: { data: UplinkCommand; ports: MediaPort[] }) => void): unknown;
  postMessage(message: UplinkEvent): void;
};

export function cleanAudioPackets(payload: unknown): BatchPacket[] {
  if (!Array.isArray(payload)) return [];
  const cleaned: BatchPacket[] = [];
  for (const packet of payload as { t?: unknown; d?: unknown }[]) {
    if (typeof packet?.t !== "number" || !(packet.d instanceof ArrayBuffer)) continue;
    cleaned.push({ timestampUs: packet.t, payload: new Uint8Array(packet.d) });
  }
  return cleaned;
}

export function createAudioUplinkService(parent: ParentPort, createTransport: AudioPublisherDeps["createTransport"]) {
  const publisher = new AudioPublisher({
    createTransport,
    startCapture: () => parent.postMessage({ t: "capture", on: true }),
    stopCapture: () => parent.postMessage({ t: "capture", on: false }),
    onUpdate: ({ streaming, webListeners }) => parent.postMessage({ t: "update", streaming, webListeners }),
    now: () => Date.now(),
    log: (message, ...args) => parent.postMessage({ t: "log", message, args: args.map(String) })
  });

  let media: MediaPort | null = null;
  const onMedia = (data: unknown) => {
    const { packets, status } = (data ?? {}) as { packets?: unknown; status?: unknown };
    publisher.handleChunks(cleanAudioPackets(packets));
    if (typeof status === "object" && status !== null) publisher.handleCaptureStatus(status as AudioCaptureStatus);
  };

  parent.on("message", ({ data, ports }) => {
    switch (data.t) {
      case "creds":
        publisher.setCredentials(data.creds);
        return;
      case "state":
        publisher.updateLocalState(data.state);
        return;
      case "status":
        publisher.handleCaptureStatus(data.status);
        return;
      case "port":
        media?.close();
        media = ports[0] ?? null;
        media?.on("message", event => onMedia(event.data));
        media?.start();
    }
  });
}

if (process.parentPort) createAudioUplinkService(process.parentPort, (url, handlers) => new AudioRelayClient(url, handlers));
