import { fetchResponse } from "./fetch-response.ts";

const BASE = "http://127.0.0.1:9863";

type RequestOptions = { method?: string; token?: string; body?: unknown; timeoutMs?: number };

export async function portInUse() {
  try {
    await fetchResponse((signal) => fetch(`${BASE}/metadata`, { signal }), 2000, "companion port probe");
    return true;
  } catch {
    return false;
  }
}

export async function request(pathname: string, { method = "GET", token, body, timeoutMs = 10000 }: RequestOptions = {}) {
  const headers = { "Content-Type": "application/json", ...(token ? { Authorization: token } : {}) };
  const res = await fetchResponse(
    (signal) =>
      fetch(`${BASE}${pathname}`, {
        signal,
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
    timeoutMs,
    `${method} ${pathname}`
  );
  let json: unknown = null;
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

export async function waitForServer(timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  let last: string | null = null;
  while (Date.now() < deadline) {
    try {
      const res = await request("/metadata", { timeoutMs: 2000 });
      if (res.status === 200) return res.body;
      last = `status ${res.status}`;
    } catch (error) {
      last = String(error);
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`companion server not reachable within ${timeoutMs}ms (last=${last})`);
}
