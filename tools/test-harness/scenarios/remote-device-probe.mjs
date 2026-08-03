// Dumps the parts of YouTube Music's own store that could describe playback on
// another device on the same account: cast/lounge/remote/queue slices. Run it
// while a phone on the same account is playing to see whether the web client
// learns about that session, and through which slice.
//
// Read-only by design: it never joins, claims or controls a session. Local
// diagnostic; meaningful results need a signed-in profile.

export const fixture = {
  playback: {
    continueWhereYouLeftOff: false,
    continueWhereYouLeftOffPaused: false,
    enableSpeakerFill: false,
    progressInTaskbar: false,
    ratioVolume: false
  }
};

const SLICE_PATTERN = "device|session|remote|lounge|mdx|cast|transfer";

export default async function remoteDeviceProbe(ctx) {
  await ctx.step("hooks ready", () => ctx.waitYtm("!!window.__YTMD_HOOK__", hooked => hooked === true, 90000), 95000);

  await ctx.step("store slices enumerated", async () => {
    const keys = await ctx.evalYtm(`JSON.stringify(Object.keys(window.__YTMD_HOOK__.ytmStore.getState() ?? {}))`);
    ctx.emit("probe", { topLevelKeys: JSON.parse(keys) });
  });

  await ctx.step("candidate slices dumped", async () => {
    const dump = await ctx.evalYtm(`(() => {
      const state = window.__YTMD_HOOK__.ytmStore.getState() ?? {};
      const pattern = new RegExp("${SLICE_PATTERN}", "i");
      const found = {};
      for (const [key, value] of Object.entries(state)) {
        if (pattern.test(key)) {
          found[key] = value;
          continue;
        }
        if (value && typeof value === "object") {
          for (const inner of Object.keys(value)) {
            if (pattern.test(inner)) {
              found[key] = found[key] ?? {};
              found[key][inner] = value[inner];
            }
          }
        }
      }
      try {
        return JSON.stringify(found);
      } catch {
        return JSON.stringify(Object.keys(found));
      }
    })()`);
    ctx.emit("probe", { candidateSlices: JSON.parse(dump) });
  });
}
