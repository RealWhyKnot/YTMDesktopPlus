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

export async function matchedStylesOnTarget(port, urlPattern, selectors, { timeoutMs = 30000 } = {}) {
  const targets = await listTargets(port);
  const target = targets.find(t => t.type === "page" && urlPattern.test(t.url));
  if (!target) throw new Error(`no target matching ${urlPattern}`);

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let nextId = 0;
  const pending = new Map();

  const send = (method, params) =>
    withTimeout(
      new Promise((resolve, reject) => {
        const id = ++nextId;
        pending.set(id, { resolve, reject });
        ws.send(JSON.stringify({ id, method, params }));
      }),
      timeoutMs,
      method
    );

  try {
    await withTimeout(
      new Promise((resolve, reject) => {
        ws.onopen = resolve;
        ws.onerror = () => reject(new Error("cdp socket error"));
      }),
      5000,
      "cdp connect"
    );
    ws.onmessage = event => {
      const message = JSON.parse(event.data);
      const waiter = pending.get(message.id);
      if (!waiter) return;
      pending.delete(message.id);
      if (message.error) waiter.reject(new Error(`${message.error.message}`));
      else waiter.resolve(message.result);
    };

    await send("DOM.enable", {});
    await send("CSS.enable", {});
    const { root } = await send("DOM.getDocument", { depth: -1, pierce: true });

    const out = {};
    for (const selector of selectors) {
      try {
        const { nodeId } = await send("DOM.querySelector", { nodeId: root.nodeId, selector });
        if (!nodeId) {
          out[selector] = { found: false };
          continue;
        }
        const matched = await send("CSS.getMatchedStylesForNode", { nodeId });
        const rules = [];
        for (const entry of matched.matchedCSSRules ?? []) {
          const rule = entry.rule;
          const colour = (rule.style?.cssProperties ?? []).filter(property => ["color", "fill", "background-color"].includes(property.name) && property.value);
          if (colour.length === 0) continue;
          rules.push({
            selector: (rule.selectorList?.text ?? "").slice(0, 160),
            origin: rule.origin,
            declarations: colour.map(property => ({
              name: property.name,
              value: property.value.slice(0, 90),
              important: Boolean(property.important),
              disabled: Boolean(property.disabled)
            }))
          });
        }
        const inherited = [];
        for (const layer of matched.inherited ?? []) {
          for (const entry of layer.matchedCSSRules ?? []) {
            const colour = (entry.rule.style?.cssProperties ?? []).filter(property => property.name === "color" && property.value);
            if (colour.length === 0) continue;
            inherited.push({
              selector: (entry.rule.selectorList?.text ?? "").slice(0, 120),
              value: colour[colour.length - 1].value.slice(0, 60)
            });
          }
        }
        out[selector] = { found: true, rules, inherited: inherited.slice(0, 6) };
      } catch (error) {
        out[selector] = { found: false, error: String(error) };
      }
    }
    return out;
  } finally {
    try {
      ws.close();
    } catch {
      // already closed
    }
  }
}

export async function screenshotOnTarget(port, urlPattern, { timeoutMs = 30000 } = {}) {
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
          if (message.id !== 1) return;
          if (message.error) reject(new Error(message.error.message));
          else resolve(message.result);
        };
        ws.onclose = () => reject(new Error("cdp socket closed"));
        ws.send(JSON.stringify({ id: 1, method: "Page.captureScreenshot", params: { format: "png", captureBeyondViewport: false } }));
      }),
      timeoutMs,
      "capture screenshot"
    );
    return Buffer.from(result.data, "base64");
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
