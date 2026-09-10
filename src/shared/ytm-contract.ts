export const PLAYER_API_MEMBERS = [
  "addEventListener",
  "getCurrentTime",
  "getDuration",
  "getPlayerResponse",
  "getPlayerState",
  "getPlaylistId",
  "getVideoData",
  "getVolume",
  "isMuted",
  "isReady",
  "mute",
  "nextVideo",
  "pauseVideo",
  "playVideo",
  "previousVideo",
  "seekTo",
  "setVolume",
  "unMute"
] as const;

export const PLAYER_API_DUCK_TYPE = ["isReady", "getPlayerState", "getVolume"] as const;

export const KNOWN_PLAYER_API_RESOLVER = "resolvePlayerApi";

export const PLAYER_API_RESOLVER_PATTERN = /^(resolve|get|fetch|ensure|load|await)[A-Za-z0-9_$]*(player|api)/i;

export function missingPlayerApiMembers(api: unknown): string[] {
  if (!api || (typeof api !== "object" && typeof api !== "function")) return [];
  const target = api as Record<string, unknown>;
  return PLAYER_API_MEMBERS.filter(name => typeof target[name] !== "function");
}
