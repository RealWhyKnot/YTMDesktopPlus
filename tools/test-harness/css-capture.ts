import { writeFileSync } from "node:fs";
import path from "node:path";

export function captureCssOptions(profileDir: string, previous: string | undefined) {
  const captureFile = path.join(path.dirname(profileDir), "capture-css.cjs");
  const outputFile = path.join(path.dirname(profileDir), "injected-css.jsonl");
  writeFileSync(
    captureFile,
    `if (process.versions.electron && process.type === 'browser' && process.env.YTMD_TEST === '1') {
    process.nextTick(() => {
    const { app } = require('electron');
    const { appendFileSync } = require('node:fs');
    const output = ${JSON.stringify(outputFile)};
    app.on('web-contents-created', (_event, contents) => {
      contents.on('did-navigate', () => appendFileSync(output, JSON.stringify({ id: contents.id, reset: true }) + '\\n'));
      const insert = contents.insertCSS.bind(contents);
      const remove = contents.removeInsertedCSS.bind(contents);
      contents.insertCSS = async (text, ...options) => {
        const key = await insert(text, ...options);
        appendFileSync(output, JSON.stringify({ id: contents.id, key, text }) + '\\n');
        return key;
      };
      contents.removeInsertedCSS = async key => {
        await remove(key);
        appendFileSync(output, JSON.stringify({ id: contents.id, key, removed: true }) + '\\n');
      };
    });
    });
  }`
  );
  return `${previous ?? ""} --require=${JSON.stringify(captureFile.replaceAll("\\", "/"))}`.trim();
}
