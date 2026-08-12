import type { RemoteTrack } from "./mirror-engine";

// Response walking for the InnerTube calls the mirror makes. Pure, so the
// shapes YTM actually returns can be pinned down in tests.

function runsText(runs: { text?: string }[] | undefined): string {
  return (runs ?? []).map(run => run.text ?? "").join("");
}

type FlexColumn = { musicResponsiveListItemFlexColumnRenderer?: { text?: { runs?: { text?: string }[] } } };
type FixedColumn = { musicResponsiveListItemFixedColumnRenderer?: { text?: { runs?: { text?: string }[] } } };
type ListItem = {
  flexColumns?: FlexColumn[];
  fixedColumns?: FixedColumn[];
  thumbnail?: { musicThumbnailRenderer?: { thumbnail?: { thumbnails?: { url?: string }[] } } };
  playlistItemData?: { videoId?: string };
};

/** The first tracks of a FEmusic_history browse response, newest first.
 *  Duration rides along in the fixed columns as "m:ss" or "h:mm:ss" when the
 *  row has one; parsing it here saves a lookup call entirely. */
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
      const columns = (item.flexColumns ?? []).map(column => runsText(column.musicResponsiveListItemFlexColumnRenderer?.text?.runs));
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
          thumbnailUrl: thumbnails.length ? (thumbnails[thumbnails.length - 1].url ?? null) : null,
          durationSeconds
        });
      }
      return;
    }
    for (const value of Object.values(node)) visit(value);
  };

  visit(browseResponse);
  return items;
}

/** A track's length from an InnerTube player response; null when unusable. */
export function extractDurationSeconds(playerResponse: unknown): number | null {
  const length = Number((playerResponse as { videoDetails?: { lengthSeconds?: string } } | null)?.videoDetails?.lengthSeconds);
  return Number.isFinite(length) && length > 0 ? length : null;
}
