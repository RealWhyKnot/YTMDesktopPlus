import { UpdateChannel } from "./store/schema";

export const UPDATE_FEED_BASE = "https://ytmdesktopplus.com/update";

export type ResolvedUpdateChannel = "stable" | "beta";

// The version string is the channel marker: nightly builds carry a -beta
// prerelease suffix, stable builds do not.
export function resolveUpdateChannel(channelSetting: UpdateChannel, version: string): ResolvedUpdateChannel {
  if (channelSetting === UpdateChannel.Stable) return "stable";
  if (channelSetting === UpdateChannel.Beta) return "beta";
  return version.includes("-beta") ? "beta" : "stable";
}

export function buildUpdateFeedUrl(channelSetting: UpdateChannel, version: string, platform: string, arch: string): string {
  const channel = resolveUpdateChannel(channelSetting, version);
  return `${UPDATE_FEED_BASE}/${channel}/${platform}-${arch}/${version}`;
}
