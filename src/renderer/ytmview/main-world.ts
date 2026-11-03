import { contextBridge, ipcRenderer } from "electron";
import { AD_PRUNE_CONTRACT } from "~shared/ad-contract";
import { PINNED_EXPERIMENT_FLAGS } from "~shared/ytm-contract";
import { installAdPrune } from "./ad-prune";
import { installExperimentFlagPins } from "./experiment-flags";
import { installIntentionalPause } from "./intentional-pause";
import { installQueueProjection } from "~shared/queue-projection";

export function installMainWorldHooks() {
  const isAdBlockEnabled: boolean = ipcRenderer.sendSync("ytmView:adBlockEnabled") === true;
  contextBridge.executeInMainWorld({ func: installAdPrune, args: [isAdBlockEnabled, AD_PRUNE_CONTRACT] });
  contextBridge.executeInMainWorld({ func: installQueueProjection });
  contextBridge.executeInMainWorld({ func: installExperimentFlagPins, args: [PINNED_EXPERIMENT_FLAGS] });
  contextBridge.executeInMainWorld({ func: installIntentionalPause });

  contextBridge.executeInMainWorld({
    func: () => {
      type YTMStore = Record<string, unknown>;
      const hookWindow = window as typeof window & { __YTMD_HOOK__?: Readonly<{ ytmStore: YTMStore }> };
      const fakeBaseClass = function (this: { store?: YTMStore }) {
        try {
          if (!hookWindow.__YTMD_HOOK__) {
            if (this.store && !!this.store.getState && !!this.store.dispatch && !!this.store.subscribe) {
              const ytmdHook = {
                ytmStore: this.store,
              };
              Object.freeze(ytmdHook);
              hookWindow.__YTMD_HOOK__ = ytmdHook;
            }
          }
        } catch (error) {
          console.warn("main-world: operation failed", error);
        }
      };
      Object.defineProperty(window, "PolymerFakeBaseClassWithoutHtml", {
        set: () => undefined,
        get: () => fakeBaseClass,
      });
    },
  });

  contextBridge.executeInMainWorld({
    func: () => {
      type AudioGraph = { context: AudioContext; source: MediaElementAudioSourceNode; out: GainNode };
      const graphWindow = window as typeof window & { __ytmdAudioGraph?: AudioGraph; __ytmdEnsureAudioGraph?: () => AudioGraph | null };

      graphWindow.__ytmdEnsureAudioGraph = () => {
        let graph = graphWindow.__ytmdAudioGraph;
        if (!graph) {
          const video = document.querySelector("video");
          if (!video) return null;

          const context = new AudioContext();
          const source = context.createMediaElementSource(video);
          const out = context.createGain();
          source.connect(out);
          out.connect(context.destination);

          graph = { context, source, out };
          graphWindow.__ytmdAudioGraph = graph;
        }

        if (graph.context.state === "suspended") void graph.context.resume().catch((error: unknown) => console.warn("installMainWorldHooks failed", error));
        return graph;
      };
    },
  });
}
