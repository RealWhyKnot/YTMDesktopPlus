import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AutoRoom } from "../src/main/integrations/listen-along/auto-room";
import type { RoomPhase } from "../src/shared/room-protocol";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

function makeHarness(overrides: { enabled?: boolean; name?: string | null } = {}) {
  const state = {
    enabled: overrides.enabled ?? true,
    phase: "idle" as RoomPhase,
    isHost: false,
    name: overrides.name ?? null,
    hosts: [] as Array<string | null>,
    leaves: 0,
    logs: [] as string[]
  };
  const autoRoom = new AutoRoom({
    enabled: () => state.enabled,
    phase: () => state.phase,
    isHost: () => state.isHost,
    savedDisplayName: () => state.name,
    host: displayName => {
      state.hosts.push(displayName);
      state.phase = "connecting";
      state.isHost = true;
    },
    leave: () => {
      state.leaves++;
      state.phase = "idle";
      state.isHost = false;
    },
    log: message => state.logs.push(message)
  });
  return { autoRoom, state };
}

function failHostedRoom(autoRoom: AutoRoom, state: ReturnType<typeof makeHarness>["state"]) {
  state.phase = "failed";
  state.isHost = true;
  autoRoom.evaluate();
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
    failHostedRoom(autoRoom, state);
    vi.advanceTimersByTime(4999);
    expect(state.hosts).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(state.hosts).toHaveLength(2);
    expect(state.logs).toEqual(["Room failed, opening a new one in 5s"]);
  });

  it("backs off while regrown rooms keep failing and resets once one is up", () => {
    const { autoRoom, state } = makeHarness();
    autoRoom.evaluate();
    const waits: number[] = [];
    for (let i = 0; i < 5; i++) {
      failHostedRoom(autoRoom, state);
      const before = state.hosts.length;
      let waited = 0;
      while (state.hosts.length === before && waited < 600_000) {
        vi.advanceTimersByTime(1000);
        waited += 1000;
      }
      waits.push(waited);
    }
    expect(waits).toEqual([5_000, 30_000, 120_000, 300_000, 300_000]);

    state.phase = "hosting";
    autoRoom.evaluate();
    failHostedRoom(autoRoom, state);
    vi.advanceTimersByTime(5000);
    expect(state.hosts).toHaveLength(7);
  });

  it("does not regrow a failed joined room", () => {
    const { autoRoom, state } = makeHarness();
    state.phase = "failed";
    state.isHost = false;
    autoRoom.evaluate();
    vi.advanceTimersByTime(600_000);
    expect(state.hosts).toHaveLength(0);
  });

  it("schedules one regrow however often it is evaluated", () => {
    const { autoRoom, state } = makeHarness();
    autoRoom.evaluate();
    failHostedRoom(autoRoom, state);
    autoRoom.evaluate();
    autoRoom.evaluate();
    expect(vi.getTimerCount()).toBe(1);
    expect(state.logs).toEqual(["Room failed, opening a new one in 5s"]);
    vi.advanceTimersByTime(600_000);
    expect(state.hosts).toHaveLength(2);
  });

  it("drops a pending regrow once a room is back up, so the next failure regrows quickly", () => {
    const { autoRoom, state } = makeHarness();
    autoRoom.evaluate();
    failHostedRoom(autoRoom, state);
    vi.advanceTimersByTime(5_000);
    failHostedRoom(autoRoom, state);
    vi.advanceTimersByTime(30_000);
    failHostedRoom(autoRoom, state);
    expect(state.hosts).toHaveLength(3);

    state.phase = "hosting";
    autoRoom.evaluate();
    expect(vi.getTimerCount()).toBe(0);

    vi.advanceTimersByTime(10_000);
    failHostedRoom(autoRoom, state);
    vi.advanceTimersByTime(5_000);
    expect(state.hosts).toHaveLength(4);
  });

  it("drops a pending regrow after a manual leave", () => {
    const { autoRoom, state } = makeHarness();
    autoRoom.evaluate();
    failHostedRoom(autoRoom, state);
    autoRoom.noteManualLeave(true);
    vi.advanceTimersByTime(600_000);
    expect(state.hosts).toHaveLength(1);
  });

  it("drops a pending regrow once the feature is off", () => {
    const { autoRoom, state } = makeHarness();
    autoRoom.evaluate();
    failHostedRoom(autoRoom, state);
    state.enabled = false;
    vi.advanceTimersByTime(600_000);
    expect(state.hosts).toHaveLength(1);
  });

  it("dispose cancels a pending regrow and stops further hosting", () => {
    const { autoRoom, state } = makeHarness();
    autoRoom.evaluate();
    failHostedRoom(autoRoom, state);
    autoRoom.dispose();
    vi.advanceTimersByTime(600_000);
    state.phase = "idle";
    autoRoom.evaluate();
    expect(state.hosts).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});
