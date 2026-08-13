// Picks the most mixable upcoming track. Candidates are the queue entries
// after the current one plus YTM's automix suggestions, addressed the way
// playQueueIndex counts them: items first, then automix.

import type { PlayerQueue, VideoDetails } from "../../../shared/addons/sdk";
import type { FeatureDb } from "./feature-db";
import { scorePair } from "./scoring";

export type NextPick = {
  queueIndex: number;
  videoId: string;
  title: string;
  score: number;
};

export function pickNext(queue: PlayerQueue | null, current: VideoDetails | null, db: FeatureDb, recentVideoIds: string[]): NextPick | null {
  if (!queue) return null;
  const currentFeatures = current ? db.get(current.id) : null;

  const candidates: { queueIndex: number; videoId: string; title: string; author: string }[] = [];
  for (let i = queue.selectedItemIndex + 1; i < queue.items.length; i++) {
    const item = queue.items[i];
    if (item?.videoId) candidates.push({ queueIndex: i, videoId: item.videoId, title: item.title, author: item.author });
  }
  for (let j = 0; j < queue.automixItems.length; j++) {
    const item = queue.automixItems[j];
    if (item?.videoId) candidates.push({ queueIndex: queue.items.length + j, videoId: item.videoId, title: item.title, author: item.author });
  }
  if (candidates.length === 0) return null;

  let best: NextPick | null = null;
  for (const candidate of candidates) {
    const score = scorePair(currentFeatures, db.get(candidate.videoId), {
      recentVideoIds,
      currentAuthor: current?.author,
      candidateAuthor: candidate.author
    });
    if (!best || score > best.score) {
      best = { queueIndex: candidate.queueIndex, videoId: candidate.videoId, title: candidate.title, score };
    }
  }
  return best;
}
