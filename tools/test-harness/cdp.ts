import { cdpTargets, parseCdpMessage, messageResult, type CdpResult } from "./cdp-values.ts";
import { fetchResponse } from "./fetch-response.ts";

const withTimeout = <T>(promise: Promise<T>, ms: number, label: string): Promise<T> =>
  Promise.race([promise, new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`timeout after ${ms}ms: ${label}`)), ms))]);

export function devToolsActivePort(text: string | null) {
  const match = /^(\d+)\r?\n/.exec(text ?? "");
  return match ? Number(match[1]) : null;
}

export function inspectorPort(line: string | null) {
  const match = /Debugger listening on ws:\/\/127\.0\.0\.1:(\d+)\//.exec(line ?? "");
  return match ? Number(match[1]) : null;
}

export async function listTargets(port: number | null) {
  const res = await fetchResponse((signal) => fetch(`http://127.0.0.1:${port}/json/list`, { signal }), 3000, "list targets");
  return cdpTargets(await res.json());
}

export async function evalOnTarget(port: number | null, urlPattern: RegExp, expression: string, { awaitPromise = true, timeoutMs = 10000 } = {}) {
  const targets = await listTargets(port);
  const target = targets.find((t) => (t.type === "page" || t.type === "node") && urlPattern.test(t.url));
  if (!target) throw new Error(`no target matching ${urlPattern}`);

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  try {
    await withTimeout(
      new Promise<Event>((resolve, reject) => {
        ws.onopen = resolve;
        ws.onerror = () => reject(new Error("cdp socket error"));
      }),
      5000,
      "cdp connect"
    );
    const result = await withTimeout(
      new Promise<CdpResult>((resolve, reject) => {
        ws.onmessage = (event) => {
          const message = parseCdpMessage(event.data);
          if (message.id === 1) resolve(messageResult(message));
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
    } catch (error) {
      console.warn("cdp: operation failed", error);
    }
  }
}

export async function matchedStylesOnTarget(port: number | null, urlPattern: RegExp, selectors: string[], { timeoutMs = 30000 } = {}) {
  const targets = await listTargets(port);
  const target = targets.find((t) => t.type === "page" && urlPattern.test(t.url));
  if (!target) throw new Error(`no target matching ${urlPattern}`);

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let nextId = 0;
  const pending = new Map<number, { resolve(value: CdpResult): void; reject(error: Error): void }>();

  const send = (method: string, params: Record<string, unknown>) =>
    withTimeout(
      new Promise<CdpResult>((resolve, reject) => {
        const id = ++nextId;
        pending.set(id, { resolve, reject });
        ws.send(JSON.stringify({ id, method, params }));
      }),
      timeoutMs,
      method
    );

  try {
    await withTimeout(
      new Promise<Event>((resolve, reject) => {
        ws.onopen = resolve;
        ws.onerror = () => reject(new Error("cdp socket error"));
      }),
      5000,
      "cdp connect"
    );
    ws.onmessage = (event) => {
      const message = parseCdpMessage(event.data);
      if (message.id === undefined) return;
      const waiter = pending.get(message.id);
      if (!waiter) return;
      pending.delete(message.id);
      if (message.error) waiter.reject(new Error(message.error.message));
      else waiter.resolve(messageResult(message));
    };

    await send("DOM.enable", {});
    await send("CSS.enable", {});
    const { root } = await send("DOM.getDocument", { depth: -1, pierce: true });
    if (root === undefined) throw new Error("CDP document root is missing");

    const out = new Map<
      string,
      | { found: false; error?: string }
      | {
          found: true;
          rules: { selector: string; origin: string; declarations: { name: string; value: string; important: boolean; disabled: boolean }[] }[];
          inherited: { selector: string; value: string }[];
        }
    >();
    for (const selector of selectors) {
      try {
        const { nodeId } = await send("DOM.querySelector", { nodeId: root.nodeId, selector });
        if (!nodeId) {
          out.set(selector, { found: false });
          continue;
        }
        const matched = await send("CSS.getMatchedStylesForNode", { nodeId });
        const rules = [];
        for (const entry of matched.matchedCSSRules ?? []) {
          const rule = entry.rule;
          const colour = (rule.style?.cssProperties ?? []).filter(
            (property) => ["color", "fill", "background-color"].includes(property.name) && property.value
          );
          if (colour.length === 0) continue;
          rules.push({
            selector: (rule.selectorList?.text ?? "").slice(0, 160),
            origin: rule.origin,
            declarations: colour.map((property) => ({
              name: property.name,
              value: property.value.slice(0, 90),
              important: Boolean(property.important),
              disabled: Boolean(property.disabled),
            })),
          });
        }
        const inherited = [];
        for (const layer of matched.inherited ?? []) {
          for (const entry of layer.matchedCSSRules ?? []) {
            const colour = (entry.rule.style?.cssProperties ?? []).filter((property) => property.name === "color" && property.value);
            if (colour.length === 0) continue;
            inherited.push({
              selector: (entry.rule.selectorList?.text ?? "").slice(0, 120),
              value: (colour.at(-1)?.value ?? "").slice(0, 60),
            });
          }
        }
        out.set(selector, { found: true, rules, inherited: inherited.slice(0, 6) });
      } catch (error) {
        out.set(selector, { found: false, error: String(error) });
      }
    }
    return Object.fromEntries(out);
  } finally {
    try {
      ws.close();
    } catch (error) {
      console.warn("cdp: operation failed", error);
    }
  }
}

export async function screenshotOnTarget(port: number | null, urlPattern: RegExp, { timeoutMs = 30000 } = {}) {
  const targets = await listTargets(port);
  const target = targets.find((t) => t.type === "page" && urlPattern.test(t.url));
  if (!target) throw new Error(`no target matching ${urlPattern}`);

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  try {
    await withTimeout(
      new Promise<Event>((resolve, reject) => {
        ws.onopen = resolve;
        ws.onerror = () => reject(new Error("cdp socket error"));
      }),
      5000,
      "cdp connect"
    );
    const result = await withTimeout(
      new Promise<CdpResult>((resolve, reject) => {
        ws.onmessage = (event) => {
          const message = parseCdpMessage(event.data);
          if (message.id !== 1) return;
          if (message.error) reject(new Error(message.error.message));
          else resolve(messageResult(message));
        };
        ws.onclose = () => reject(new Error("cdp socket closed"));
        ws.send(JSON.stringify({ id: 1, method: "Page.captureScreenshot", params: { format: "png", captureBeyondViewport: false } }));
      }),
      timeoutMs,
      "capture screenshot"
    );
    if (result.data === undefined) throw new Error("CDP screenshot data is missing");
    return Buffer.from(result.data, "base64");
  } finally {
    try {
      ws.close();
    } catch (error) {
      console.warn("cdp: operation failed", error);
    }
  }
}

export async function waitForTarget(port: number | null, urlPattern: RegExp, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const targets = await listTargets(port);
      const target = targets.find((t) => t.type === "page" && urlPattern.test(t.url));
      if (target) return target;
    } catch (error) {
      console.warn("cdp: operation failed", error);
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`target ${urlPattern} did not appear within ${timeoutMs}ms`);
}

export async function waitForValue(
  port: number | null,
  urlPattern: RegExp,
  expression: string,
  predicate: (value: unknown) => boolean,
  timeoutMs: number,
  { intervalMs = 2000 } = {}
) {
  const deadline = Date.now() + timeoutMs;
  let lastValue;
  let lastError: string | null = null;
  while (Date.now() < deadline) {
    try {
      lastValue = await evalOnTarget(port, urlPattern, expression);
      lastError = null;
      if (predicate(lastValue)) return lastValue;
    } catch (error) {
      lastError = String(error);
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`condition not met within ${timeoutMs}ms: ${expression.slice(0, 80)} (last=${JSON.stringify(lastValue)} lastError=${lastError})`);
}
