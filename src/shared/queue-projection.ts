import type { PlayerQueueItem } from "./addons/sdk";

export type ProjectedQueue = {
  items: (PlayerQueueItem | null)[];
  automixItems: (PlayerQueueItem | null)[];
  autoplay: boolean;
  isGenerating: boolean;
  isInfinite: boolean;
  repeatMode: string;
};

export function installQueueProjection(): void {
  type Runs = { runs?: { text?: string }[] } | null | undefined;
  type Renderer = {
    thumbnail?: { thumbnails?: { url: string; width: number; height: number }[] };
    title?: Runs;
    shortBylineText?: Runs;
    lengthText?: Runs;
    selected?: boolean;
    videoId?: string;
  };
  type Entry = {
    playlistPanelVideoRenderer?: Renderer;
    playlistPanelVideoWrapperRenderer?: {
      primaryRenderer?: { playlistPanelVideoRenderer?: Renderer };
      counterpart?: { counterpartRenderer?: { playlistPanelVideoRenderer?: Renderer } }[];
    };
  };
  type Queue = { items?: Entry[]; automixItems?: Entry[]; autoplay?: boolean; isGenerating?: boolean; isInfinite?: boolean; repeatMode?: string };

  const text = (value: Runs) => (value?.runs ?? []).map(run => run.text ?? "").join("");

  const project = (renderer: Renderer, counterparts: PlayerQueueItem[] | null): PlayerQueueItem => ({
    thumbnails: (renderer.thumbnail?.thumbnails ?? []).map(thumbnail => ({ url: thumbnail.url, width: thumbnail.width, height: thumbnail.height })),
    title: text(renderer.title),
    author: text(renderer.shortBylineText),
    duration: text(renderer.lengthText),
    selected: renderer.selected === true,
    videoId: renderer.videoId ?? "",
    counterparts
  });

  const projectEntry = (entry: Entry): PlayerQueueItem | null => {
    if (entry?.playlistPanelVideoRenderer) return project(entry.playlistPanelVideoRenderer, null);
    const wrapper = entry?.playlistPanelVideoWrapperRenderer;
    const primary = wrapper?.primaryRenderer?.playlistPanelVideoRenderer;
    if (!primary) return null;
    const counterparts = wrapper.counterpart
      ? wrapper.counterpart.flatMap(counterpart => {
          const renderer = counterpart?.counterpartRenderer?.playlistPanelVideoRenderer;
          return renderer ? [project(renderer, null)] : [];
        })
      : null;
    return project(primary, counterparts);
  };

  (window as typeof window & { __ytmdProjectQueue?: (queue: Queue | null | undefined) => unknown }).__ytmdProjectQueue = queue =>
    queue
      ? {
          items: (queue.items ?? []).map(projectEntry),
          automixItems: (queue.automixItems ?? []).map(projectEntry),
          autoplay: queue.autoplay === true,
          isGenerating: queue.isGenerating === true,
          isInfinite: queue.isInfinite === true,
          repeatMode: String(queue.repeatMode ?? "")
        }
      : null;
}
