// Minimal Chrome DevTools Protocol helpers. Connections are one-shot per
// evaluation: list targets, connect, evaluate, close. That trades a little
// overhead for never holding a socket that can silently die mid-run. Every
// network operation carries its own timeout.

const withTimeout = (promise, ms, label) =>
  Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error(`timeout after ${ms}ms: ${label}`)), ms))]);

export async function listTargets(port) {
  const res = await withTimeout(fetch(`http://127.0.0.1:${port}/json/list`), 3000, "list targets");
  return res.json();
}

export async function evalOnTarget(port, urlPattern, expression, { awaitPromise = true, timeoutMs = 10000 } = {}) {
  const targets = await listTargets(port);
  const target = targets.find(t => t.type === "page" && urlPattern.test(t.url));
  if (!target) throw new Error(`no target matching ${urlPattern}`);

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  try {
    await withTimeout(
      new Promise((resolve, reject) => {
        ws.onopen = resolve;
        ws.onerror = () => reject(new Error("cdp socket error"));
      }),
      5000,
      "cdp connect"
    );
    const result = await withTimeout(
      new Promise((resolve, reject) => {
        ws.onmessage = event => {
          const message = JSON.parse(event.data);
          if (message.id === 1) resolve(message.result);
        };
        ws.onclose = () => reject(new Error("cdp socket closed"));
        ws.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { expression, returnByValue: true, awaitPromise } }));
      }),
      timeoutMs,
      `evaluate on ${target.url.slice(0, 60)}`
    );
    if (result.exceptionDetails) {
      throw new Error(`evaluation threw: ${result.exceptionDetails.exception?.description ?? "unknown"}`);
    }
    return result.result?.value;
  } finally {
    try {
      ws.close();
    } catch {
      // already closed
    }
  }
}

export async function waitForTarget(port, urlPattern, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const targets = await listTargets(port);
      const target = targets.find(t => t.type === "page" && urlPattern.test(t.url));
      if (target) return target;
    } catch {
      // CDP not up yet
    }
    await new Promise(r => setTimeout(r, 1000));
  }
  throw new Error(`target ${urlPattern} did not appear within ${timeoutMs}ms`);
}

export async function waitForValue(port, urlPattern, expression, predicate, timeoutMs, { intervalMs = 2000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastValue;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      lastValue = await evalOnTarget(port, urlPattern, expression);
      lastError = null;
      if (predicate(lastValue)) return lastValue;
    } catch (error) {
      lastError = String(error);
    }
    await new Promise(r => setTimeout(r, intervalMs));
  }
  throw new Error(`condition not met within ${timeoutMs}ms: ${expression.slice(0, 80)} (last=${JSON.stringify(lastValue)} lastError=${lastError})`);
}
