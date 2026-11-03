import type { RemoteTrack } from "./mirror-engine";
import { isRecord } from "~shared/unknown";

function runsText(runs: { text?: string }[] | undefined): string {
  return (runs ?? []).map((run) => run.text ?? "").join("");
}

type FlexColumn = { musicResponsiveListItemFlexColumnRenderer?: { text?: { runs?: { text?: string }[] } } };
type FixedColumn = { musicResponsiveListItemFixedColumnRenderer?: { text?: { runs?: { text?: string }[] } } };
type ListItem = {
  flexColumns?: FlexColumn[];
  fixedColumns?: FixedColumn[];
  thumbnail?: { musicThumbnailRenderer?: { thumbnail?: { thumbnails?: { url?: string }[] } } };
  playlistItemData?: { videoId?: string };
};

export function extractHistoryHead(browseResponse: unknown, limit = 3): RemoteTrack[] {
  const items: RemoteTrack[] = [];

  const visit = (node: unknown): void => {
    if (!node || typeof node !== "object" || items.length >= limit) return;
    if (Array.isArray(node)) {
      for (const entry of node) visit(entry);
      return;
    }
    const item = (node as { musicResponsiveListItemRenderer?: ListItem }).musicResponsiveListItemRenderer;
    if (item) {
      const columns = (item.flexColumns ?? []).map((column) => runsText(column.musicResponsiveListItemFlexColumnRenderer?.text?.runs));
      const thumbnails = item.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails ?? [];
      let durationSeconds: number | null = null;
      for (const fixed of item.fixedColumns ?? []) {
        const text = runsText(fixed.musicResponsiveListItemFixedColumnRenderer?.text?.runs);
        if (/^\d+(:\d{2})+$/.test(text)) {
          durationSeconds = text.split(":").reduce((total, part) => total * 60 + Number(part), 0);
          break;
        }
      }
      const videoId = item.playlistItemData?.videoId ?? null;
      if (videoId) {
        items.push({
          videoId,
          title: columns[0] ?? "",
          author: columns[1] ?? "",
          thumbnailUrl: thumbnails.at(-1)?.url ?? null,
          durationSeconds,
        });
      }
      return;
    }
    for (const value of Object.values(node)) visit(value);
  };

  visit(browseResponse);
  return items;
}

export function extractDurationSeconds(playerResponse: unknown): number | null {
  const details = isRecord(playerResponse) ? playerResponse.videoDetails : undefined;
  const length = Number(isRecord(details) ? details.lengthSeconds : undefined);
  return Number.isFinite(length) && length > 0 ? length : null;
}
