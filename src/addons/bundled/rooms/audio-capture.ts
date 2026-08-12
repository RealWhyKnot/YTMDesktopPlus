import type { BatchPacket } from "~shared/audio-protocol";
import enableScript from "./scripts/audiocapture-enable.script?raw";
import disableScript from "./scripts/audiocapture-disable.script?raw";

/** Encoded packets as the page posts them, filtered down to the well formed. */
export function cleanAudioPackets(payload: unknown): BatchPacket[] {
  if (!Array.isArray(payload)) return [];
  const cleaned: BatchPacket[] = [];
  for (const packet of payload as { t?: unknown; d?: unknown }[]) {
    if (typeof packet?.t !== "number" || !(packet.d instanceof ArrayBuffer)) continue;
    cleaned.push({ timestampUs: packet.t, payload: new Uint8Array(packet.d) });
  }
  return cleaned;
}

// Captures the YTM page's audio for Listen Along rooms. The page-side script
// splits the shared audio graph into an ear path and a broadcast tap, moves
// the local volume onto the ear path so the stream is immune to it, and
// encodes the tap with WebCodecs. Encoded packets arrive as addon messages;
// this class only manages injection. Injection is driven by the addon that
// owns it, which passes runScript in, so this never talks to the view
// directly.
export default class AudioStreamCapture {
  private hasInjected = false;
  private isEnabled = false;
  private waitForYTMView = true;

  constructor(private readonly runScript: (name: "enable" | "disable") => void) {}

  public enable(): void {
    this.isEnabled = true;
    if (this.hasInjected || this.waitForYTMView) return;

    this.runScript("enable");
    this.hasInjected = true;
  }

  public disable(): void {
    this.isEnabled = false;
    if (!this.hasInjected) return;

    this.runScript("disable");
    this.hasInjected = false;
  }

  public getYTMScripts(): { name: string; script: string }[] {
    return [
      { name: "enable", script: enableScript },
      { name: "disable", script: disableScript }
    ];
  }

  public ytmViewLoaded(): void {
    this.waitForYTMView = false;
    if (this.isEnabled) {
      // The page was (re)loaded, so any previous injection is gone.
      this.hasInjected = false;
      this.enable();
    }
  }
}
