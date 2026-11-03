import { playerStateStore } from "../../src/main/player-state-store";
import type { VideoDetailsPayload } from "../../src/main/ipc/ytm-view-payloads";

export function partialPlayerState(video: VideoDetailsPayload = { videoId: "partial" }) {
  playerStateStore.updateQueue(null);
  playerStateStore.updateVideoDetails(video, undefined, null, undefined, true);
  playerStateStore.updateVideoState(1);
  return playerStateStore.getState();
}
