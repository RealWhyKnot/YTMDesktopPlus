export function runScript() {
  const state: unknown = Reflect.get(window, "__ytmdBlend");
  if (typeof state === "object" && state !== null && "detachAll" in state && typeof state.detachAll === "function") Reflect.apply(state.detachAll, state, []);
  return true;
}
