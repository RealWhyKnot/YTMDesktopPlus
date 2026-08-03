// Per-track gain from YouTube's own measured loudness.
//
// audioConfig.loudnessDb is how far a track sits above the platform's loudness
// target. Attenuate only: tracks louder than the target come down to it,
// quieter tracks are left alone rather than boosted into clipping. A gain
// node composes multiplicatively with HTMLMediaElement.volume, so this never
// fights the volume slider or the ratio volume patch.
//
// The page script in integrations/loudness-normalization embeds this same
// formula; it cannot import modules.
export function gainFromLoudnessDb(loudnessDb: unknown): number {
  if (typeof loudnessDb !== "number" || !Number.isFinite(loudnessDb) || loudnessDb <= 0) return 1;
  return Math.pow(10, -loudnessDb / 20);
}
