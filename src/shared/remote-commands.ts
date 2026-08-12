import type { RemoteCommandName, YTMRepeatMode } from "./addons/sdk";

/** Every command the player page's remote-control switch handles. Kept in
 *  step with the preload by a test that reads its case labels. */
export const REMOTE_COMMAND_NAMES = [
  "playPause",
  "play",
  "pause",
  "next",
  "previous",
  "toggleLike",
  "toggleDislike",
  "volumeUp",
  "volumeDown",
  "setVolume",
  "mute",
  "unmute",
  "repeatMode",
  "seekTo",
  "shuffle",
  "playQueueIndex",
  "navigate"
] as const satisfies readonly RemoteCommandName[];

const REPEAT_MODES: readonly YTMRepeatMode[] = ["NONE", "ALL", "ONE"];

/** Returns a human-readable problem, or null when the command is well formed.
 *  Names outside the vocabulary pass: the page-side switch ignores what it
 *  does not know, and a newer page may know more. */
export function validateRemoteCommand(command: string, value?: unknown): string | null {
  switch (command as RemoteCommandName) {
    case "setVolume":
      return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100 ? null : "value must be a number from 0 to 100";
    case "seekTo":
      return typeof value === "number" && Number.isFinite(value) && value >= 0 ? null : "value must be a non-negative number of seconds";
    case "repeatMode":
      return REPEAT_MODES.includes(value as YTMRepeatMode) ? null : 'value must be "NONE", "ALL" or "ONE"';
    case "playQueueIndex":
      return typeof value === "number" && Number.isInteger(value) && value >= 0 ? null : "value must be a non-negative queue index";
    case "navigate": {
      const endpoint = value === null || typeof value !== "object" ? null : (value as { watchEndpoint?: unknown }).watchEndpoint;
      return endpoint !== null && typeof endpoint === "object" ? null : "value must carry a watchEndpoint object";
    }
    default:
      return null;
  }
}
