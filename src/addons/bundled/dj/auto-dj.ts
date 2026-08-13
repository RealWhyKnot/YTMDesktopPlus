// Picks the most mixable upcoming track. Candidates are the queue entries
// after the current one plus YTM's automix suggestions, addressed the way
// playQueueIndex counts them (items first, then automix), joined by analyzed
// tracks from the library that are not queued yet.

import type { PlayerQueue, VideoDetails } from "../../../shared/addons/sdk";
import type { FeatureDb } from "./feature-db";
import { scorePair, type TrackFeatures } from "./scoring";

export type NextPick = {
  // Null for a library pick that still has to be enqueued
  queueIndex: number | null;
  videoId: string;
  title: string;
  score: number;
  source: "queue" | "library";
};

// Library tracks join only when they clearly beat the queue's best; hopping
// out of the queue for a marginal gain would make the radio feel random.
const LIBRARY_MARGIN = 0.1;

// Digs the queue-shaped renderer for a video out of an innertube next
// response, wrapped the way ADD_ITEMS expects queue items.
export function findQueueItemRenderer(node: unknown, videoId: string): { playlistPanelVideoRenderer: Record<string, unknown> } | null {
  if (!node || typeof node !== "object") return null;
  const record = node as Record<string, unknown>;
  const renderer = record.playlistPanelVideoRenderer as Record<string, unknown> | undefined;
  if (renderer && renderer.videoId === videoId) return { playlistPanelVideoRenderer: renderer };
  for (const value of Array.isArray(node) ? (node as unknown[]) : Object.values(record)) {
    const found = findQueueItemRenderer(value, videoId);
    if (found) return found;
  }
  return null;
}

export function libraryCandidates(db: FeatureDb, queue: PlayerQueue | null, current: VideoDetails | null): TrackFeatures[] {
  const queued = new Set<string>();
  if (queue) {
    for (const item of queue.items) queued.add(item.videoId);
    for (const item of queue.automixItems) queued.add(item.videoId);
  }
  return db.all().filter(track => track.title != null && track.videoId !== current?.id && !queued.has(track.videoId));
}

export function pickNext(queue: PlayerQueue | null, current: VideoDetails | null, db: FeatureDb, recentVideoIds: string[]): NextPick | null {
  if (!queue) return null;
  const currentFeatures = current ? db.get(current.id) : null;

  const queueCandidates: { queueIndex: number; videoId: string; title: string; author: string }[] = [];
  for (let i = queue.selectedItemIndex + 1; i < queue.items.length; i++) {
    const item = queue.items[i];
    if (item?.videoId) queueCandidates.push({ queueIndex: i, videoId: item.videoId, title: item.title, author: item.author });
  }
  for (let j = 0; j < queue.automixItems.length; j++) {
    const item = queue.automixItems[j];
    if (item?.videoId) queueCandidates.push({ queueIndex: queue.items.length + j, videoId: item.videoId, title: item.title, author: item.author });
  }
  if (queueCandidates.length === 0) return null;

  let best: NextPick | null = null;
  for (const candidate of queueCandidates) {
    const score = scorePair(currentFeatures, db.get(candidate.videoId), {
      recentVideoIds,
      currentAuthor: current?.author,
      candidateAuthor: candidate.author
    });
    if (!best || score > best.score) {
      best = { queueIndex: candidate.queueIndex, videoId: candidate.videoId, title: candidate.title, score, source: "queue" };
    }
  }

  // The library only competes when the current track is analyzed; otherwise
  // every comparison is neutral and the queue should win. Recently played
  // tracks stay in the pool; the scoring recency penalty prices them out.
  if (currentFeatures) {
    for (const track of libraryCandidates(db, queue, current)) {
      const score = scorePair(currentFeatures, track, {
        recentVideoIds,
        currentAuthor: current?.author,
        candidateAuthor: track.author ?? undefined
      });
      if (best && score > best.score + LIBRARY_MARGIN) {
        best = { queueIndex: null, videoId: track.videoId, title: track.title ?? track.videoId, score, source: "library" };
      }
    }
  }
  return best;
}
