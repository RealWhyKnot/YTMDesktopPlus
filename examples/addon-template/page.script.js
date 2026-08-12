// Runs inside the YouTube Music page. The file must evaluate to a function;
// the app calls it after every page load and whenever the addon invokes it by
// name ("page.script"). window.__YTMD_HOOK__.ytmStore is the page's own store:
// getState, dispatch and subscribe.
(function () {
  const hook = window.__YTMD_HOOK__;
  // The page state is YTM's own and untyped; declare just the slice in use.
  const state = hook && /** @type {{ queue?: { items?: unknown[] } }} */ (hook.ytmStore.getState());
  return {
    path: location.pathname,
    queued: !!(state && state.queue && state.queue.items && state.queue.items.length)
  };
});
