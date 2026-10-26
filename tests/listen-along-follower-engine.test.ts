import { describe, expect, it, vi } from "vitest";
import { FollowerEngine, type FollowerPhaseEvent } from "../src/main/integrations/listen-along/follower-engine";
import type { CueResult } from "../src/main/playback/cue-track";
import { VideoState, type PlayerState } from "../src/main/player-state-store";
import { makePlayerState, makeVideoDetails } from "./helpers/fake-addon-context";

const NOW = 1_754_236_800_000;

function local(videoId: string, progress: number): PlayerState {
  return makePlayerState({
    videoDetails: makeVideoDetails({ id: videoId, durationSeconds: 300 }),
    videoProgress: progress,
    trackState: VideoState.Playing,
    hasFullMetadata: true
  });
}

function harness() {
  let nowMs = NOW;
  const cues: Array<(result: CueResult) => void> = [];
  const phases: FollowerPhaseEvent[] = [];
  const cancelCue = vi.fn();
  const engine = new FollowerEngine({
    cueTrack: () => new Promise<CueResult>(resolve => cues.push(resolve)),
    sendCommand: vi.fn(),
    onPhase: event => phases.push(event),
    now: () => nowMs,
    cancelCue
  });
  const follow = (videoId: string) => {
    nowMs += 1000;
    engine.updateRemote({ videoId, durationSeconds: 300, progress: 10, trackState: VideoState.Playing, adPlaying: false, asOfMs: nowMs });
  };
  return { engine, cues, phases, cancelCue, follow };
}

describe("FollowerEngine track cues", () => {
  it("cancels the cue it is still waiting on when reset", () => {
    const h = harness();
    h.engine.updateLocal(local("localTrack1", 5));
    h.follow("hostTrack01");
    expect(h.cues).toHaveLength(1);

    h.engine.reset();

    expect(h.cancelCue).toHaveBeenCalledTimes(1);
  });

  it("does not cancel a cue that already finished", async () => {
    const h = harness();
    h.engine.updateLocal(local("localTrack1", 5));
    h.follow("hostTrack01");
    h.cues[0]("seeked");
    await Promise.resolve();

    h.engine.reset();

    expect(h.cancelCue).not.toHaveBeenCalled();
  });

  it("ignores a cue that finishes after a reset", async () => {
    const h = harness();
    h.engine.updateLocal(local("localTrack1", 5));
    h.follow("hostTrack01");
    h.engine.reset();
    h.engine.updateLocal(local("localTrack1", 5));
    h.follow("hostTrack02");
    expect(h.engine.currentPhase).toBe("loading");
    const before = h.phases.length;

    h.cues[0]("seeked");
    await Promise.resolve();

    expect(h.engine.currentPhase).toBe("loading");
    expect(h.phases).toHaveLength(before);

    h.cues[1]("seeked");
    await Promise.resolve();
    expect(h.engine.currentPhase).toBe("synced");
  });
});
