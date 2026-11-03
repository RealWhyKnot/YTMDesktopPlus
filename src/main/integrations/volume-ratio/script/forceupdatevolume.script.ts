export function runScript() {
  function isPlayerApi(value: unknown): value is { getVolume(): unknown; setVolume(volume: number): unknown } {
    return (
      typeof value === "object" &&
      value !== null &&
      "getVolume" in value &&
      typeof value.getVolume === "function" &&
      "setVolume" in value &&
      typeof value.setVolume === "function"
    );
  }
  function isStore(value: unknown): value is { dispatch(action: { type: string; payload: number }): unknown } {
    return typeof value === "object" && value !== null && "dispatch" in value && typeof value.dispatch === "function";
  }
  const bar = document.querySelector("ytmusic-app-layout>ytmusic-player-bar");
  const playerApi = bar && "playerApi" in bar ? bar.playerApi : undefined;
  if (!isPlayerApi(playerApi)) return;
  const volume = playerApi.getVolume();
  if (typeof volume !== "number") return;
  playerApi.setVolume(volume);
  const hook: unknown = Reflect.get(window, "__YTMD_HOOK__");
  const store = typeof hook === "object" && hook !== null && "ytmStore" in hook ? hook.ytmStore : undefined;
  if (isStore(store)) store.dispatch({ type: "SET_VOLUME", payload: volume });
}
