// The track the player is already going to move to: the next queue entry, or
// YTM's first automix suggestion once the queue runs out. Auto DJ reads it to
// shape the blend into that track; it never changes which track it is.

import type { PlayerQueue } from "../../../shared/addons/sdk";

export type NextTrack = { videoId: string; title: string };

export function resolveNextTrack(queue: PlayerQueue | null): NextTrack | null {
  if (!queue) return null;
  const upcoming = queue.items[queue.selectedItemIndex + 1] ?? queue.automixItems[0];
  return upcoming?.videoId ? { videoId: upcoming.videoId, title: upcoming.title } : null;
}
