import type { HarnessContext } from "./run.ts";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { array, record, stringValue } from "./values.ts";

export async function collectProjectCss(ctx: HarnessContext) {
  await ctx.waitYtm(
    "!!document.getElementById('ytmd-theme') && [...document.querySelectorAll('style')].some(style => style.id !== 'ytmd-theme' && style.textContent.includes('.ytmd-history-back'))",
    (value) => value === true,
    30000
  );
  const dom = record(
    await ctx.evalYtm(`(() => ({
    theme: document.getElementById('ytmd-theme')?.textContent,
    controls: [...document.querySelectorAll('style')].find(style => style.id !== 'ytmd-theme' && style.textContent.includes('.ytmd-history-back'))?.textContent
  }))()`)
  );
  const contentsId = await ctx.evalMainProcess(
    `process.mainModule.require('electron').webContents.getAllWebContents().find(item => item.getURL().startsWith('https://music.youtube.com/'))?.id`
  );
  const active = new Map<string, string>();
  for (const line of readFileSync(path.join(ctx.runDir, "injected-css.jsonl"), "utf8").split("\n").filter(Boolean)) {
    const parsed: unknown = JSON.parse(line);
    const entry = record(parsed);
    if (entry.id !== contentsId) continue;
    if (entry.reset === true) active.clear();
    else if (entry.removed === true) active.delete(stringValue(entry.key));
    else active.set(stringValue(entry.key), stringValue(entry.text));
  }
  const css = { dom: { theme: stringValue(dom.theme), controls: stringValue(dom.controls) }, injected: [...active].map(([key, text]) => ({ key, text })) };
  writeFileSync(path.join(ctx.runDir, "ytm-project-css.json"), JSON.stringify(css));
  ctx.emit("applied-css", { injected: css.injected.map((sheet) => ({ key: sheet.key, bytes: sheet.text.length })) });
  return css;
}

export async function replaceProjectCss(ctx: HarnessContext, previous: Awaited<ReturnType<typeof collectProjectCss>>, source: string) {
  const parsed: unknown = JSON.parse(readFileSync(source, "utf8"));
  const replacement = record(parsed);
  const dom = record(replacement.dom);
  const injected = array(replacement.injected).map((value) => stringValue(record(value).text));
  await ctx.evalYtm(`(() => {
    for (const element of document.querySelectorAll('.ytmd-history-back, .ytmd-history-forward')) {
      if (element.classList.contains('disabled')) element.setAttribute('aria-disabled', 'true');
    }
    for (const element of document.querySelectorAll('.ytmd-player-bar-control.library-button, .ytmd-player-bar-control.playlist-button')) {
      if (element.classList.contains('hidden')) element.setAttribute('hidden', '');
    }
    for (const element of document.querySelectorAll('.ytmd-player-bar-control.sleep-timer-button')) {
      if (element.classList.contains('active')) element.setAttribute('aria-pressed', 'true');
    }
    document.getElementById('ytmd-theme').textContent = ${JSON.stringify(stringValue(dom.theme))};
    [...document.querySelectorAll('style')].find(style => style.id !== 'ytmd-theme' && style.textContent.includes('.ytmd-history-back')).textContent = ${JSON.stringify(stringValue(dom.controls))};
    return true;
  })()`);
  await ctx.evalMainProcess(`(async () => {
    const contents = process.mainModule.require('electron').webContents.getAllWebContents().find(item => item.getURL().startsWith('https://music.youtube.com/'));
    for (const key of ${JSON.stringify(previous.injected.map((sheet) => sheet.key))}) await contents.removeInsertedCSS(key);
    for (const text of ${JSON.stringify(injected)}) await contents.insertCSS(text);
    return true;
  })()`);
}
