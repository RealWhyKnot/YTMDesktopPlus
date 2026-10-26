import fs from "fs";
import path from "path";
import { isContainedRelativePath } from "./validate-manifest";
import { preprocessCss, tokenizeCss, type CssToken, type CssTokenType } from "./css-tokenizer";

export type BundledCss = {
  css: string;
  warnings: string[];
};

const MAX_INLINE_BYTES = 4 * 1024 * 1024;

const MIME_BY_EXTENSION: Record<string, string> = {
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".svg": "image/svg+xml"
};

const URL_FUNCTIONS = new Set(["url", "src"]);
const IMAGE_LIST_FUNCTIONS = new Set(["image-set", "-webkit-image-set", "image", "cross-fade", "-webkit-cross-fade"]);
const DYNAMIC_FUNCTIONS = new Set(["var", "env", "attr"]);
const CLOSER: Partial<Record<CssTokenType, CssTokenType>> = { "function": ")", "(": ")", "[": "]", "{": "}" };

type Resolution = { kind: "keep" } | { kind: "replace"; url: string } | { kind: "remove" };

export function inlineAsset(filePath: string): string | null {
  const mime = MIME_BY_EXTENSION[path.extname(filePath).toLowerCase()];
  if (!mime) return null;
  const stats = fs.statSync(filePath);
  if (!stats.isFile() || stats.size > MAX_INLINE_BYTES) return null;
  return `data:${mime};base64,${fs.readFileSync(filePath).toString("base64")}`;
}

const trimControls = (value: string) => {
  let start = 0;
  let end = value.length;
  while (start < end && value.charCodeAt(start) <= 0x20) start++;
  while (end > start && value.charCodeAt(end - 1) <= 0x20) end--;
  return value.slice(start, end);
};

const quoteCss = (value: string) => `"${value.replace(/[\\"]/g, char => `\\${char}`).replace(/\n/g, "\\a ")}"`;

export function bundleThemeCss(css: string, themeDir: string): BundledCss {
  const warnings: string[] = [];
  const seen = new Set<string>();
  const warn = (message: string) => {
    if (seen.has(message)) return;
    seen.add(message);
    warnings.push(message);
  };

  const resolveReference = (value: string): Resolution => {
    const raw = trimControls(value.replace(/[\t\n\r]/g, ""));
    if (raw === "") return { kind: "keep" };
    if (/^data:/i.test(raw)) return { kind: "keep" };
    if (raw.startsWith("#")) return { kind: "keep" };
    if (/^[\\/]{2}/.test(raw) || (/^[a-z][a-z0-9+.-]*:/i.test(raw) && !/^[a-z]:/i.test(raw))) {
      warn(`remote url was removed: ${raw.slice(0, 80)}`);
      return { kind: "remove" };
    }

    const reference = raw.split(/[?#]/)[0];
    if (!isContainedRelativePath(reference)) {
      warn(`url must stay inside the theme folder: ${reference.slice(0, 80)}`);
      return { kind: "remove" };
    }

    const absolute = path.resolve(themeDir, reference);
    if (path.relative(themeDir, absolute).startsWith("..")) {
      warn(`url must stay inside the theme folder: ${reference.slice(0, 80)}`);
      return { kind: "remove" };
    }

    try {
      const dataUrl = inlineAsset(absolute);
      if (!dataUrl) {
        warn(`file could not be embedded: ${reference.slice(0, 80)}`);
        return { kind: "remove" };
      }
      return { kind: "replace", url: dataUrl };
    } catch {
      warn(`file is missing: ${reference.slice(0, 80)}`);
      return { kind: "remove" };
    }
  };

  const source = preprocessCss(css);
  const tokens = tokenizeCss(source);
  const text = (token: CssToken) => source.slice(token.start, token.end);
  const significant = (token: CssToken) => token.type !== "whitespace" && token.type !== "comment";
  const isDynamic = (token: CssToken) => token.type === "function" && DYNAMIC_FUNCTIONS.has(token.value.toLowerCase());

  const blockEnd = (open: number): number => {
    const stack: CssTokenType[] = [CLOSER[tokens[open].type]!];
    for (let i = open + 1; i < tokens.length; i++) {
      const closer = CLOSER[tokens[i].type];
      if (closer) stack.push(closer);
      else if (tokens[i].type === stack[stack.length - 1]) {
        stack.pop();
        if (stack.length === 0) return i;
      }
    }
    return tokens.length;
  };

  const atRuleEnd = (start: number, limit: number): number => {
    for (let i = start + 1; i < limit; i++) {
      const type = tokens[i].type;
      if (type === ";") return i + 1;
      if (type === "}") return i;
      if (type === "{") return Math.min(blockEnd(i) + 1, limit);
      if (CLOSER[type]) i = blockEnd(i);
    }
    return limit;
  };

  const urlFunction = (open: number, close: number): string => {
    const terminated = close < tokens.length;
    const inner = tokens.slice(open + 1, close).filter(significant);
    if (inner.length === 0) return terminated ? source.slice(tokens[open].start, tokens[close].end) : "url()";
    if (inner.length === 1 && inner[0].type === "string" && !inner[0].unterminated) {
      const resolution = resolveReference(inner[0].value);
      if (resolution.kind === "remove") return "none";
      if (resolution.kind === "replace") return `url(${quoteCss(resolution.url)})`;
      return terminated ? source.slice(tokens[open].start, tokens[close].end) : `url(${quoteCss(inner[0].value)})`;
    }
    if (inner.some(isDynamic)) warn("a url built from var(), env() or attr() was removed");
    else warn("a url that could not be read was removed");
    return "none";
  };

  const emit = (from: number, to: number, imageList: boolean): { text: string; blocked: boolean; open: CssTokenType[] } => {
    let out = "";
    let blocked = false;
    const open: CssTokenType[] = [];
    for (let i = from; i < to; i++) {
      const token = tokens[i];
      if (token.type === "at-keyword" && token.value.toLowerCase() === "import") {
        warn("@import was removed: a theme may not pull in stylesheets");
        out += " ";
        i = atRuleEnd(i, to) - 1;
        continue;
      }
      if (token.type === "function" && URL_FUNCTIONS.has(token.value.toLowerCase())) {
        const close = Math.min(blockEnd(i), to);
        out += urlFunction(i, close);
        i = close;
        continue;
      }
      if (token.type === "function" && IMAGE_LIST_FUNCTIONS.has(token.value.toLowerCase())) {
        const close = Math.min(blockEnd(i), to);
        if (tokens.slice(i + 1, close).some(isDynamic)) {
          warn("a url built from var(), env() or attr() was removed");
          out += "none";
        } else {
          const body = emit(i + 1, close, true);
          if (body.blocked) out += "none";
          else out += text(token) + body.text + (close < tokens.length ? text(tokens[close]) : [...body.open].reverse().join("") + ")");
        }
        i = close;
        continue;
      }
      if (token.type === "url") {
        const resolution = resolveReference(token.value);
        if (resolution.kind === "remove") out += "none";
        else if (resolution.kind === "replace") out += `url(${quoteCss(resolution.url)})`;
        else out += token.unterminated ? `url(${quoteCss(token.value)})` : text(token);
        continue;
      }
      if (token.type === "bad-url") {
        warn("a url that could not be read was removed");
        out += "none";
        continue;
      }
      if (imageList && open.length === 0 && token.type === "string") {
        const resolution = resolveReference(token.value);
        if (resolution.kind === "remove") blocked = true;
        else if (resolution.kind === "replace") out += quoteCss(resolution.url);
        else out += token.unterminated ? quoteCss(token.value) : text(token);
        continue;
      }

      if (token.type === "comment" && token.unterminated) out += `${text(token)}*/`;
      else if (token.type === "string" && token.unterminated) out += quoteCss(token.value);
      else out += text(token);

      const closer = CLOSER[token.type];
      if (closer) open.push(closer);
      else if (open.length > 0 && token.type === open[open.length - 1]) open.pop();
    }
    return { text: out, blocked, open };
  };

  const result = emit(0, tokens.length, false);
  let output = result.text + [...result.open].reverse().join("");
  if (output !== "" && !/\s$/.test(output)) output += "\n";
  return { css: output, warnings };
}

export function bundleThemeFile(themeDir: string, relativePath: string): BundledCss {
  const absolute = path.resolve(themeDir, relativePath);
  if (path.relative(themeDir, absolute).startsWith("..")) {
    return { css: "", warnings: [`stylesheet must stay inside the theme folder: ${relativePath}`] };
  }
  try {
    return bundleThemeCss(fs.readFileSync(absolute, "utf8"), themeDir);
  } catch {
    return { css: "", warnings: [`stylesheet is missing: ${relativePath}`] };
  }
}
