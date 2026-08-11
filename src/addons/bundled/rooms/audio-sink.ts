import type { BatchPacket } from "~shared/audio-protocol";
import type { AudioCaptureStatus } from "../../../main/integrations/listen-along/audio-publisher";

// The YTM page bridge sends capture traffic on fixed channels guarded by the
// main entry point (only the view itself may send them). While the rooms
// addon is active it plugs a sink in here; otherwise the traffic is dropped.
export type RoomsAudioSink = {
  handleChunks(packets: BatchPacket[]): void;
  handleCaptureStatus(status: AudioCaptureStatus): void;
};

let audioSink: RoomsAudioSink | null = null;

export function setAudioSink(sink: RoomsAudioSink | null): void {
  audioSink = sink;
}

export function getRoomsAudioSink(): RoomsAudioSink | null {
  return audioSink;
}
