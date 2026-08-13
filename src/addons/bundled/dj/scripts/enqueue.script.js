// Inserts a queue item right after the current selection. Invoked with
// { item } where item is a playlistPanelVideoRenderer wrapper the way queue
// items carry them; returns the index the item landed at, or -1.

(function (request) {
  const item = request && request.item;
  if (!item || typeof item !== "object") return -1;
  const hook = window.__YTMD_HOOK__;
  if (!hook || !hook.ytmStore) return -1;
  const store = hook.ytmStore;
  const queue = store.getState().queue;
  if (!queue || !Array.isArray(queue.items)) return -1;

  const index = queue.selectedItemIndex + 1;
  store.dispatch({
    type: "ADD_ITEMS",
    payload: {
      nextQueueItemId: queue.nextQueueItemId,
      index,
      items: [item],
      shuffleEnabled: false,
      shouldAssignIds: true
    }
  });
  return index;
});
