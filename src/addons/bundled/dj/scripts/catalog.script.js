// Ships the playing track's encoded audio to the addon for analysis: newest
// audio segment URL, range and ump stripped, fetched whole and posted as an
// ArrayBuffer. Invoked with { videoId }; returns false when no segment URL is
// visible yet so the addon can retry later.

(async function (request) {
  const videoId = request && request.videoId;
  if (!videoId) return false;

  const state = (window.__ytmdDjCatalog = window.__ytmdDjCatalog || { inFlight: null });
  if (state.inFlight === videoId) return true;

  const entries = performance.getEntriesByType("resource").filter(e => /videoplayback/.test(e.name) && /mime=audio/.test(e.name));
  if (!entries.length) return false;
  const url = new URL(entries[entries.length - 1].name);
  for (const p of ["range", "rn", "rbuf", "ump", "srfvp", "alr"]) url.searchParams.delete(p);

  state.inFlight = videoId;
  try {
    const response = await fetch(url.toString(), { credentials: "omit" });
    if (!response.ok) return false;
    const buffer = await response.arrayBuffer();
    window.ytmd.postAddonMessage("dj", "audioData", { videoId, buffer });
    return true;
  } catch {
    return false;
  } finally {
    if (state.inFlight === videoId) state.inFlight = null;
  }
});
