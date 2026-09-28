import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

const source = readFileSync("src/renderer/ytmview/scripts/playerbarcontrols.script.js", "utf8").trim();

function element() {
  const classes = new Set<string>();
  return {
    classList: {
      add: (name: string) => classes.add(name),
      remove: (name: string) => classes.delete(name),
      contains: (name: string) => classes.has(name)
    },
    setters: { data: vi.fn(), iconName: vi.fn() },
    insertAdjacentElement: () => {},
    querySelector: () => element(),
    appendChild: () => {},
    setAttribute: () => {},
    set: () => {}
  };
}

const libraryMenu = {
  items: [
    {
      toggleMenuServiceItemRenderer: {
        defaultIcon: { iconType: "BOOKMARK_BORDER" },
        defaultServiceEndpoint: { feedbackEndpoint: { feedbackToken: "save" } },
        toggledServiceEndpoint: { feedbackEndpoint: { feedbackToken: "unsave" } }
      }
    }
  ]
};

let subscribers: (() => void)[];
let state: Record<string, unknown>;
let created: ReturnType<typeof element>[];
let getMenuRenderer: Mock;
let documentQueries: number;

const dispatch = () => subscribers.forEach(subscriber => subscriber());

beforeEach(() => {
  subscribers = [];
  created = [];
  documentQueries = 0;
  getMenuRenderer = vi.fn(() => libraryMenu);
  state = { queue: { items: [] }, toggleStates: { feedbackToggleStates: {} }, player: { volume: 50 } };
  const playerBar = { ...element(), getMenuRenderer, playerApi: { addEventListener: () => {}, getPlayerResponse: (): unknown => null } };

  vi.stubGlobal("document", {
    querySelector: () => {
      documentQueries++;
      return playerBar;
    },
    createElement: () => {
      const node = element();
      created.push(node);
      return node;
    }
  });
  vi.stubGlobal("window", {
    __YTMD_HOOK__: { ytmStore: { getState: () => state, subscribe: (subscriber: () => void) => subscribers.push(subscriber), dispatch: () => {} } },
    addEventListener: () => {},
    ytmd: { reportContractMiss: () => {} }
  });

  new Function(`return (${source.replace(/;$/, "")})`)()();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("playerbarcontrols script", () => {
  it("reads the player bar menu only when the queue or toggle states change", () => {
    const queriesAtStart = documentQueries;

    dispatch();
    state = { ...state, player: { volume: 60 } };
    dispatch();
    dispatch();
    state = { ...state, queue: { items: [{}] } };
    dispatch();
    state = { ...state, toggleStates: { feedbackToggleStates: { save: true } } };
    dispatch();

    expect(getMenuRenderer).toHaveBeenCalledTimes(3);
    expect(documentQueries).toBe(queriesAtStart);
  });

  it("shows the library state after it is toggled", () => {
    const libraryButton = created[0];

    dispatch();
    expect(libraryButton.setters.iconName).toHaveBeenLastCalledWith("yt-sys-icons:library_add");

    state = { ...state, toggleStates: { feedbackToggleStates: { save: true } } };
    dispatch();
    expect(libraryButton.setters.iconName).toHaveBeenLastCalledWith("yt-sys-icons:library_saved");
  });
});
