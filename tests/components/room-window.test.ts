import { afterEach, describe, expect, it, vi } from "vitest";
import { h, Suspense } from "vue";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import Room from "../../src/renderer/windows/room/Room.vue";
import type { RoomMemberView, RoomSnapshot } from "~shared/room-protocol";

const ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";

function snapshot(overrides: Partial<RoomSnapshot> = {}): RoomSnapshot {
  return {
    phase: "hosting",
    roomId: "abcdefgh",
    shareUrl: "https://ytmdesktopplus.com/r/abcdefgh",
    memberId: null,
    isHost: true,
    role: 1,
    hostName: null,
    members: [],
    listenerCount: 0,
    error: null,
    syncStatus: null,
    syncDetail: null,
    audioStreaming: false,
    webListenerCount: 0,
    audioIssue: null,
    ...overrides
  };
}

function members(count: number): RoomMemberView[] {
  return Array.from({ length: count }, (_, i) => ({ id: `${ALPHABET[i % 31]}${ALPHABET[Math.floor(i / 31)]}aaaa`, name: `Member ${i}`, role: 0 }));
}

let wrapper: VueWrapper | null = null;

async function mountRoom(room: RoomSnapshot) {
  (window as unknown as { ytmd: unknown }).ytmd = {
    memoryStore: {
      get: vi.fn(async () => ({ rooms: { room, joinPrompt: null } })),
      onStateChanged: vi.fn()
    },
    store: { get: vi.fn(async () => ({ settings: { rooms: { displayName: "Me" } } })) },
    roomControl: vi.fn(),
    roomGrant: vi.fn(),
    roomLeave: vi.fn()
  };
  wrapper = mount({ render: () => h(Suspense, null, { default: () => h(Room) }) }, { attachTo: document.body });
  await flushPromises();
  return wrapper;
}

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
});

describe("Room window", () => {
  it("keeps the you tag out of the truncated name", async () => {
    const list = members(2);
    list[1].name = "W".repeat(24);
    const view = await mountRoom(snapshot({ phase: "listening", isHost: false, role: 0, hostName: "Host", memberId: list[1].id, members: list }));
    const tag = view.find(".you-tag");
    expect(tag.exists()).toBe(true);
    expect(tag.element.closest(".member-name")).toBeNull();
    expect(tag.element.parentElement?.querySelector(".member-name")?.textContent).toBe("W".repeat(24));
  });

  it("puts the host name in its own truncating span", async () => {
    const view = await mountRoom(snapshot({ phase: "listening", isHost: false, role: 0, hostName: "Ｗ".repeat(24) }));
    expect(view.find(".room-subtitle-text").text()).toBe(`Following ${"Ｗ".repeat(24)}`);
    expect(view.find(".room-subtitle-text .listener-count").exists()).toBe(false);
  });

  it("shows the first members of a long room until asked for all of them", async () => {
    const view = await mountRoom(snapshot({ members: members(50), listenerCount: 50 }));
    expect(view.findAll(".member")).toHaveLength(9);
    const toggle = view.find(".show-all");
    expect(toggle.text()).toBe("Show all 50");

    await toggle.trigger("click");
    expect(view.findAll(".member")).toHaveLength(51);
    expect(view.find(".show-all").text()).toBe("Show fewer");
  });

  it("keeps your own entry in the short list", async () => {
    const list = members(50);
    const view = await mountRoom(
      snapshot({ phase: "listening", isHost: false, role: 0, hostName: "Host", memberId: list[40].id, members: list, listenerCount: 50 })
    );
    const names = view.findAll(".member .member-name").map(name => name.text());
    expect(names).toHaveLength(9);
    expect(names).toContain("Member 40");
    expect(view.find(".you-tag").exists()).toBe(true);
  });

  it("leaves a short room without a toggle", async () => {
    const view = await mountRoom(snapshot({ members: members(8), listenerCount: 8 }));
    expect(view.findAll(".member")).toHaveLength(9);
    expect(view.find(".show-all").exists()).toBe(false);
  });

  it.each([
    ["retrying", "Audio to the web stopped. Trying again soon."],
    ["stopped", "Audio to the web stopped. Turn streaming off and back on in Settings to try again."],
    ["outdated", "Streaming audio to the web needs a newer version of the app"]
  ] as const)("tells the host when web audio is %s", async (issue, text) => {
    const view = await mountRoom(snapshot({ audioIssue: issue }));
    expect(view.find(".audio-issue").text()).toBe(text);
  });

  it("does not show the web audio notice to listeners", async () => {
    const view = await mountRoom(snapshot({ phase: "listening", isHost: false, role: 0, hostName: "Host", audioIssue: "retrying" }));
    expect(view.find(".audio-issue").exists()).toBe(false);
  });

  it("limits what the controller inputs accept", async () => {
    const view = await mountRoom(snapshot({ phase: "listening", isHost: false, role: 1, hostName: "Host" }));
    const limits = view.findAll(".inline-field input").map(input => (input.element as HTMLInputElement).maxLength);
    expect(limits).toEqual([9, 300]);
  });

  it("limits the join input", async () => {
    const view = await mountRoom(snapshot({ phase: "idle", isHost: false, roomId: null, shareUrl: null }));
    const join = view.findAll("input").find(input => input.attributes("placeholder") === "Room link or 8 letter code");
    expect((join?.element as HTMLInputElement).maxLength).toBe(200);
  });
});
