import { readPageScript, runPageScript } from "./helpers/page-script";
import { requireValue } from "./helpers/require-value";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

const source = await readPageScript("src/renderer/ytmview/scripts/playerbarcontrols.script.ts");

function element() {
  const classes = new Set<string>();
  const attributes = new Map<string, string>();
  return {
    classList: {
      add: (name: string) => classes.add(name),
      remove: (name: string) => classes.delete(name),
      contains: (name: string) => classes.has(name),
    },
    setters: { data: vi.fn(), iconName: vi.fn() },
    insertAdjacentElement: () => {
      return undefined;
    },
    querySelector: () => element(),
    appendChild: () => {
      return undefined;
    },
    setAttribute: (name: string, value: string) => attributes.set(name, value),
    hasAttribute: (name: string) => attributes.has(name),
    removeAttribute: (name: string) => attributes.delete(name),
    set: () => {
      return undefined;
    },
  };
}

const libraryMenu = {
  items: [
    {
      toggleMenuServiceItemRenderer: {
        defaultIcon: { iconType: "BOOKMARK_BORDER" },
        defaultServiceEndpoint: { feedbackEndpoint: { feedbackToken: "save" } },
        toggledServiceEndpoint: { feedbackEndpoint: { feedbackToken: "unsave" } },
      },
    },
  ],
};

let subscribers: (() => void)[];
let state: Record<string, unknown>;
let created: ReturnType<typeof element>[];
let getMenuRenderer: Mock;
let documentQueries: number;
let misses: unknown[][];

const dispatch = () => subscribers.forEach((subscriber) => subscriber());

beforeEach(() => {
  subscribers = [];
  created = [];
  documentQueries = 0;
  misses = [];
  getMenuRenderer = vi.fn(() => libraryMenu);
  state = { queue: { items: [] }, toggleStates: { feedbackToggleStates: {} }, player: { volume: 50 } };
  const playerBar = {
    ...element(),
    getMenuRenderer,
    playerApi: {
      addEventListener: () => {
        return undefined;
      },
      getPlayerResponse: (): unknown => null,
    },
  };

  vi.stubGlobal("document", {
    querySelector: () => {
      documentQueries++;
      return playerBar;
    },
    createElement: () => {
      const node = element();
      created.push(node);
      return node;
    },
  });
  vi.stubGlobal("window", {
    __YTMD_HOOK__: {
      ytmStore: {
        getState: () => state,
        subscribe: (subscriber: () => void) => subscribers.push(subscriber),
        dispatch: () => {
          return undefined;
        },
      },
    },
    addEventListener: () => {
      return undefined;
    },
    ytmd: { reportContractMiss: (...args: unknown[]) => misses.push(args) },
  });

  runPageScript(source);
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
    expect(requireValue(libraryButton).setters.iconName).toHaveBeenLastCalledWith("yt-sys-icons:library_add");

    state = { ...state, toggleStates: { feedbackToggleStates: { save: true } } };
    dispatch();
    expect(requireValue(libraryButton).setters.iconName).toHaveBeenLastCalledWith("yt-sys-icons:library_saved");
  });

  it("survives menu and store shapes it does not recognise without throwing into YTM's dispatch", () => {
    getMenuRenderer.mockReturnValue({
      items: [null, { toggleMenuServiceItemRenderer: {} }, { toggleMenuServiceItemRenderer: { defaultIcon: { iconType: "BOOKMARK" } } }],
    });
    state = { queue: { items: [{}] } };
    expect(() => dispatch()).not.toThrow();

    getMenuRenderer.mockReturnValue({ items: "not a list" });
    state = { queue: { items: [{}, {}] }, toggleStates: null };
    expect(() => dispatch()).not.toThrow();

    getMenuRenderer.mockImplementation(() => {
      throw new Error("menu renderer moved");
    });
    state = { ...state, queue: { items: [] } };
    expect(() => dispatch()).not.toThrow();
    expect(misses).toContainEqual(["playerBarControls: store subscriber", "Error: menu renderer moved"]);
  });
});
