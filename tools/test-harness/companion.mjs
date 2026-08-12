// REST client for the companion server plus the pre-launch port probe.
// The companion port is hardcoded in the app; if another instance (for
// example an installed copy) already holds it, enabling the integration in a
// test run fails with a native error dialog. The probe turns that into a
// clean environment-blocked result before launch.

const BASE = "http://127.0.0.1:9863";

const withTimeout = (promise, ms, label) =>
  Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error(`timeout after ${ms}ms: ${label}`)), ms))]);

export async function portInUse() {
  try {
    await withTimeout(fetch(`${BASE}/metadata`), 2000, "companion port probe");
    return true;
  } catch {
    return false;
  }
}

/**
 * @param {string} pathname
 * @param {{ method?: string, token?: string, body?: unknown, timeoutMs?: number }} [options]
 */
export async function request(pathname, { method = "GET", token, body, timeoutMs = 10000 } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = token;
  const res = await withTimeout(
    fetch(`${BASE}${pathname}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body)
    }),
    timeoutMs,
    `${method} ${pathname}`
  );
  let json = null;
  const text = await res.text();
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = text;
    }
  }
  return { status: res.status, body: json };
}

export async function waitForServer(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    try {
      const res = await request("/metadata", { timeoutMs: 2000 });
      if (res.status === 200) return res.body;
      last = `status ${res.status}`;
    } catch (error) {
      last = String(error);
    }
    await new Promise(r => setTimeout(r, 1000));
  }
  throw new Error(`companion server not reachable within ${timeoutMs}ms (last=${last})`);
}
