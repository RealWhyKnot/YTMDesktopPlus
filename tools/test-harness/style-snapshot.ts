import type { HarnessContext } from "./run.ts";
import { appendFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { evalOnTarget } from "./cdp.ts";
import { array, record, numberValue } from "./values.ts";

const PREPARE_SCRIPT = `(() => {
  const elements = [];
  window.__ytmdStyleChanged = false;
  window.__ytmdStyleObserver = new MutationObserver(() => { window.__ytmdStyleChanged = true; });
  window.__ytmdStyleObserver.observe(document, { childList: true, subtree: true });
  const visit = (root, prefix) => {
    const positions = new Map();
    for (const element of [...root.children]) {
      const index = positions.get(element.localName) ?? 0;
      positions.set(element.localName, index + 1);
      const key = prefix + '/' + element.localName + '[' + index + ']';
      elements.push({ element, key });
      visit(element, key);
      if (element.shadowRoot) {
        window.__ytmdStyleObserver.observe(element.shadowRoot, { childList: true, subtree: true });
        visit(element.shadowRoot, key + '/shadow');
      }
    }
  };
  visit(document, '');
  window.__ytmdStyleCapture = elements;
  window.__ytmdStyleVariables = [];
  window.__ytmdStyleVariableIds = new Map();
  return { count: elements.length, url: location.href, viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio }, reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches };
})()`;

function batchScript(offset: number, count: number) {
  return `(() => {
  const pack = style => {
    const properties = {};
    const variables = {};
    for (const name of style) (name.startsWith('--') ? variables : properties)[name] = style.getPropertyValue(name);
    const signature = JSON.stringify(variables);
    let variableSet = window.__ytmdStyleVariableIds.get(signature);
    if (variableSet === undefined) {
      variableSet = window.__ytmdStyleVariables.length;
      window.__ytmdStyleVariableIds.set(signature, variableSet);
      window.__ytmdStyleVariables.push(variables);
    }
    return { properties, variableSet };
  };
  return window.__ytmdStyleCapture.slice(${offset}, ${offset + count}).map(({ element, key }) => {
    const style = getComputedStyle(element);
    const packed = pack(style);
    const rect = element.getBoundingClientRect();
    const bounds = { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    const pseudo = Object.fromEntries(['::before', '::after'].map(name => {
      const computed = getComputedStyle(element, name);
      if (computed.content === 'none' || computed.content === 'normal') return [name, { content: computed.content }];
      return [name, pack(computed)];
    }));
    return { key, tag: element.localName, id: element.id, className: element.getAttribute('class'), bounds, ...packed, pseudo };
  });
  })()`;
}

async function captureAttempt(ctx: HarnessContext, target: RegExp, name: string) {
  ctx.emit("style-fonts", { name, status: await ctx.evalOnTarget(target, "document.fonts.status") });
  await evalOnTarget(ctx.cdpPort, target, "document.fonts.ready.then(() => true)", { timeoutMs: 60000 });
  await ctx.evalOnTarget(
    target,
    `(() => {
      for (let pass = 0; pass < 32; pass++) {
        const finite = document.getAnimations().filter(animation => Number.isFinite(animation.effect?.getComputedTiming().endTime) && animation.playState !== 'finished');
        if (finite.length === 0) break;
        finite.forEach(animation => animation.finish());
      }
      document.getAnimations().filter(animation => !Number.isFinite(animation.effect?.getComputedTiming().endTime)).forEach(animation => { animation.pause(); animation.currentTime = 0; });
      return true;
    })()`
  );
  const header = record(await ctx.evalOnTarget(target, PREPARE_SCRIPT));
  const count = numberValue(header.count);
  ctx.emit("style-measuring", { name, count });
  const file = path.join(ctx.runDir, `${name}.json`);
  writeFileSync(file, `${JSON.stringify(header).slice(0, -1)},"entries":[`);
  try {
    for (let offset = 0; offset < count; offset += 50) {
      const entries = array(await evalOnTarget(ctx.cdpPort, target, batchScript(offset, 50), { timeoutMs: 30000 }));
      appendFileSync(file, `${offset === 0 ? "" : ","}${entries.map((entry) => JSON.stringify(entry)).join(",")}`);
      if (offset % 1000 === 0) ctx.emit("style-progress", { name, through: offset + entries.length, count });
    }
    const variableSets = await ctx.evalOnTarget(target, "window.__ytmdStyleVariables");
    appendFileSync(file, `],"variableSets":${JSON.stringify(variableSets)}}`);
    const isStable = (await ctx.evalOnTarget(target, "window.__ytmdStyleChanged || window.__ytmdStyleObserver.takeRecords().length > 0")) === false;
    return { isStable, count };
  } finally {
    await ctx.evalOnTarget(
      target,
      "window.__ytmdStyleObserver.disconnect(); delete window.__ytmdStyleObserver; delete window.__ytmdStyleChanged; delete window.__ytmdStyleCapture; delete window.__ytmdStyleVariables; delete window.__ytmdStyleVariableIds"
    );
  }
}

export async function captureStyles(ctx: HarnessContext, target: RegExp, name: string) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const result = await captureAttempt(ctx, target, name);
    if (result.isStable) {
      ctx.emit("style-captured", { name, attempt, count: result.count });
      return;
    }
    ctx.emit("style-retry", { name, attempt, reason: "Page elements changed during measurement" });
  }
  throw new Error(`Page elements kept changing while measuring ${name}`);
}

export async function setReducedMotion(ctx: HarnessContext, target: RegExp, isReduced: boolean) {
  await ctx.evalMainProcess(`(async () => {
    const { webContents } = process.mainModule.require('electron');
    const contents = webContents.getAllWebContents().find(item => ${target.toString()}.test(item.getURL()));
    if (!contents) throw new Error('Style capture target is missing');
    if (!contents.debugger.isAttached()) contents.debugger.attach('1.3');
    await contents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: ${JSON.stringify(isReduced ? "reduce" : "no-preference")} }] });
    return true;
  })()`);
  if (process.argv.includes("--reset-trial")) {
    await ctx.evalOnTarget(
      target,
      `(() => {
      document.getElementById('ytmd-motion-reset-trial')?.remove();
      if (${isReduced} && location.href.includes('/windows/')) {
        const style = document.createElement('style');
        style.id = 'ytmd-motion-reset-trial';
        style.textContent = '@media (prefers-reduced-motion: reduce) { *, ::before, ::after { animation-duration: 0.01ms !important; animation-iteration-count: 1 !important; transition-duration: 0.01ms !important; scroll-behavior: auto !important; } }';
        document.head.appendChild(style);
      }
      return true;
    })()`
    );
  }
}
