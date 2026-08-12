// Shared scenario helpers.

// Runs the companion authorization flow end to end and returns a bearer
// token: enable the approval window, request a code, and approve the native
// window while the token request long-polls.
export async function obtainCompanionToken(ctx) {
  await ctx.companion.waitForServer(30000);
  // Folded into one bounded retry loop: the main window target exists before
  // its bridge is exposed, and any individual evaluation can lose its socket.
  // The set is idempotent, so retrying the whole expression is safe.
  await ctx.waitMain("window.ytmd ? (window.ytmd.memoryStore.set('companionServerAuthWindowEnabled', true), true) : false", done => done === true, 20000);

  const codeResponse = await ctx.companion.request("/api/v1/auth/requestcode", {
    method: "POST",
    body: { appId: "ytmdesktoptestharness", appName: "Test Harness", appVersion: "1.0.0" }
  });
  if (codeResponse.status !== 200 || !codeResponse.body?.code) {
    throw new Error(`requestcode failed: ${codeResponse.status} ${JSON.stringify(codeResponse.body)}`);
  }

  // The token request blocks server-side until the user approves or the
  // request times out, so fire it before clicking Allow.
  const tokenPromise = ctx.companion.request("/api/v1/auth/request", {
    method: "POST",
    body: { appId: "ytmdesktoptestharness", code: codeResponse.body.code },
    timeoutMs: 45000
  });

  await ctx.waitTarget(/authorize-companion/, 15000);
  // Retry the click until the button exists and the click lands.
  await ctx.waitOnTarget(
    /authorize-companion/,
    "document.querySelector('button.allow') ? (document.querySelector('button.allow').click(), true) : false",
    clicked => clicked === true,
    15000
  );

  const tokenResponse = await tokenPromise;
  if (tokenResponse.status !== 200 || !tokenResponse.body?.token) {
    throw new Error(`auth request failed: ${tokenResponse.status} ${JSON.stringify(tokenResponse.body)}`);
  }
  return tokenResponse.body.token;
}

// Baseline settings fixtures shared by scenarios; override per scenario.
export function playbackFixture(overrides = {}) {
  return {
    continueWhereYouLeftOff: false,
    continueWhereYouLeftOffPaused: false,
    enableSpeakerFill: false,
    progressInTaskbar: false,
    ratioVolume: false,
    ...overrides
  };
}

export function roomIntegrationsFixture(overrides = {}) {
  return {
    companionServerEnabled: false,
    companionServerAuthTokens: null,
    companionServerCORSWildcardEnabled: false,
    discordPresenceEnabled: false,
    lastFMEnabled: false,
    listenAlongEnabled: false,
    listenAlongHost: null,
    listenAlongHostPort: 9863,
    listenAlongToken: null,
    ...overrides
  };
}

export function hooksReadyStep(ctx) {
  return ctx.step("hooks ready", () => ctx.waitYtm("!!window.__YTMD_HOOK__", hooked => hooked === true, 90000), 95000);
}
