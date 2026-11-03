export function runScript() {
  const pageWindow: Window & AdSkipWindow = window;
  const state = pageWindow.__ytmdAdSkip;
  if (!state) return "";

  if (typeof state.unsubscribe === "function") Reflect.apply(state.unsubscribe, state, []);

  state.endAd?.();

  delete pageWindow.__ytmdAdSkip;
  return "";
}
