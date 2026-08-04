import { describe, expect, it } from "vitest";

import { AutoRoom } from "../src/main/integrations/listen-along/auto-room";
import type { RoomPhase } from "../src/shared/room-protocol";

function makeHarness(overrides: { enabled?: boolean; name?: string | null } = {}) {
  const state = {
    enabled: overrides.enabled ?? true,
    phase: "idle" as RoomPhase,
    name: overrides.name ?? null,
    hosts: [] as Array<string | null>,
    leaves: 0
  };
  const autoRoom = new AutoRoom({
    enabled: () => state.enabled,
    phase: () => state.phase,
    savedDisplayName: () => state.name,
    host: displayName => {
      state.hosts.push(displayName);
      state.phase = "hosting";
    },
    leave: () => {
      state.leaves++;
      state.phase = "idle";
    }
  });
  return { autoRoom, state };
}

describe("AutoRoom", () => {
  it("hosts anonymously from idle when enabled", () => {
    const { autoRoom, state } = makeHarness();
    autoRoom.evaluate();
    expect(state.hosts).toEqual([null]);

    // Already hosting: nothing further.
    autoRoom.evaluate();
    expect(state.hosts).toHaveLength(1);
  });

  it("uses the saved display name when one exists", () => {
    const { autoRoom, state } = makeHarness({ name: "DJ" });
    autoRoom.evaluate();
    expect(state.hosts).toEqual(["DJ"]);
  });

  it("does nothing while disabled or mid-session", () => {
    const { autoRoom, state } = makeHarness({ enabled: false });
    autoRoom.evaluate();
    expect(state.hosts).toHaveLength(0);

    state.enabled = true;
    state.phase = "listening";
    autoRoom.evaluate();
    expect(state.hosts).toHaveLength(0);
  });

  it("stands down after the user leaves their own room, until a toggle cycles", () => {
    const { autoRoom, state } = makeHarness();
    autoRoom.evaluate();
    autoRoom.noteManualLeave(true);
    state.phase = "idle";
    autoRoom.evaluate();
    expect(state.hosts).toHaveLength(1);

    autoRoom.syncToggles();
    expect(state.hosts).toHaveLength(2);
  });

  it("re-hosts after leaving a room someone else owned", () => {
    const { autoRoom, state } = makeHarness();
    state.phase = "listening";
    autoRoom.noteManualSession();
    autoRoom.noteManualLeave(false);
    state.phase = "idle";
    autoRoom.evaluate();
    expect(state.hosts).toHaveLength(1);
  });

  it("closes only rooms it opened when the feature turns off", () => {
    const { autoRoom, state } = makeHarness();
    autoRoom.evaluate();
    state.enabled = false;
    autoRoom.syncToggles();
    expect(state.leaves).toBe(1);

    // A manually hosted room is not automation's to close.
    state.enabled = true;
    autoRoom.noteManualSession();
    state.phase = "hosting";
    state.enabled = false;
    autoRoom.syncToggles();
    expect(state.leaves).toBe(1);
  });

  it("regrows a room the relay expired", () => {
    const { autoRoom, state } = makeHarness();
    autoRoom.evaluate();
    state.phase = "idle";
    autoRoom.evaluate();
    expect(state.hosts).toHaveLength(2);
  });
});
