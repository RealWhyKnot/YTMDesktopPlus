// Shared scenario helpers.

// Runs the companion authorization flow end to end and returns a bearer
// token: enable the approval window, request a code, and approve the native
// window while the token request long-polls.
export async function obtainCompanionToken(ctx) {
  await ctx.companion.waitForServer(30000);
  await ctx.evalMain("window.ytmd.memoryStore.set('companionServerAuthWindowEnabled', true)");

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
  // The window animates in; retry the click until the token round-trip
  // settles it.
  await ctx.evalOnTarget(/authorize-companion/, "document.querySelector('button.allow').click()");

  const tokenResponse = await tokenPromise;
  if (tokenResponse.status !== 200 || !tokenResponse.body?.token) {
    throw new Error(`auth request failed: ${tokenResponse.status} ${JSON.stringify(tokenResponse.body)}`);
  }
  return tokenResponse.body.token;
}
