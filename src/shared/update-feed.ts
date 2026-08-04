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

// The house scheme is vYYYY.MDD.N with an optional prerelease, which is valid
// semver: numeric dotted base, and a prerelease sorts below the same base
// without one.
export function compareVersions(a: string, b: string): number {
  const parse = (value: string) => {
    const bare = value.startsWith("v") ? value.slice(1) : value;
    const [base, prerelease] = bare.split("-", 2);
    const parts = base.split(".").map(part => Number.parseInt(part, 10));
    return { parts, prerelease: prerelease ?? null };
  };
  const left = parse(a);
  const right = parse(b);
  const length = Math.max(left.parts.length, right.parts.length);
  for (let i = 0; i < length; i++) {
    const l = Number.isFinite(left.parts[i]) ? left.parts[i] : 0;
    const r = Number.isFinite(right.parts[i]) ? right.parts[i] : 0;
    if (l !== r) return l < r ? -1 : 1;
  }
  if (left.prerelease === right.prerelease) return 0;
  if (left.prerelease === null) return 1;
  if (right.prerelease === null) return -1;
  return left.prerelease < right.prerelease ? -1 : 1;
}

// Guards the install path: an update is only ever applied when it is strictly
// newer than what is running, so a feed serving an older or equal release can
// never roll the app backwards.
export function isNewerVersion(candidate: string | null | undefined, current: string): boolean {
  if (typeof candidate !== "string" || candidate.trim().length === 0) return false;
  if (!/^v?\d+(\.\d+)*(-[0-9A-Za-z.-]+)?$/.test(candidate.trim())) return false;
  return compareVersions(candidate.trim(), current) > 0;
}
