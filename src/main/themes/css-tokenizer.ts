export type CssTokenType =
  | "whitespace"
  | "comment"
  | "string"
  | "bad-string"
  | "url"
  | "bad-url"
  | "function"
  | "ident"
  | "at-keyword"
  | "hash"
  | "delim"
  | "number"
  | "percentage"
  | "dimension"
  | "cdo"
  | "cdc"
  | "("
  | ")"
  | "["
  | "]"
  | "{"
  | "}"
  | ";"
  | ":"
  | ",";

export type CssToken = {
  type: CssTokenType;
  start: number;
  end: number;
  value: string;
  unterminated?: boolean;
  quote?: string;
};

const EOF = -1;

const isDigit = (c: number) => c >= 0x30 && c <= 0x39;
const isHexDigit = (c: number) => isDigit(c) || (c >= 0x41 && c <= 0x46) || (c >= 0x61 && c <= 0x66);
const isLetter = (c: number) => (c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a);
const isIdentStart = (c: number) => isLetter(c) || c >= 0x80 || c === 0x5f;
const isIdentCode = (c: number) => isIdentStart(c) || isDigit(c) || c === 0x2d;
const isNewline = (c: number) => c === 0x0a;
const isWhitespace = (c: number) => c === 0x0a || c === 0x09 || c === 0x20;
const isNonPrintable = (c: number) => (c >= 0 && c <= 0x08) || c === 0x0b || (c >= 0x0e && c <= 0x1f) || c === 0x7f;

export function preprocessCss(css: string): string {
  return css
    .replace(/\r\n|\r|\f/g, "\n")
    .split(String.fromCharCode(0))
    .join("�");
}

export function tokenizeCss(input: string): CssToken[] {
  const codes: number[] = [];
  const offsets: number[] = [];
  for (let i = 0; i < input.length;) {
    const code = input.codePointAt(i)!;
    codes.push(code);
    offsets.push(i);
    i += code > 0xffff ? 2 : 1;
  }
  offsets.push(input.length);

  let pos = 0;
  const at = (n = 0) => (pos + n < codes.length ? codes[pos + n] : EOF);
  const validEscape = (a: number, b: number) => a === 0x5c && !isNewline(b);
  const startsIdent = (a: number, b: number, c: number) => {
    if (a === 0x2d) return isIdentStart(b) || b === 0x2d || validEscape(b, c);
    if (isIdentStart(a)) return true;
    if (a === 0x5c) return validEscape(a, b);
    return false;
  };
  const startsNumber = (a: number, b: number, c: number) => {
    if (a === 0x2b || a === 0x2d) return isDigit(b) || (b === 0x2e && isDigit(c));
    if (a === 0x2e) return isDigit(b);
    return isDigit(a);
  };

  const consumeEscape = (): string => {
    const c = at();
    if (c === EOF) return "�";
    pos++;
    if (isHexDigit(c)) {
      let hex = String.fromCodePoint(c);
      while (hex.length < 6 && isHexDigit(at())) {
        hex += String.fromCodePoint(at());
        pos++;
      }
      if (isWhitespace(at())) pos++;
      const value = Number.parseInt(hex, 16);
      if (value === 0 || (value >= 0xd800 && value <= 0xdfff) || value > 0x10ffff) return "�";
      return String.fromCodePoint(value);
    }
    return String.fromCodePoint(c);
  };

  const consumeIdentSequence = (): string => {
    let result = "";
    for (;;) {
      const c = at();
      if (isIdentCode(c)) {
        result += String.fromCodePoint(c);
        pos++;
      } else if (validEscape(c, at(1))) {
        pos++;
        result += consumeEscape();
      } else {
        return result;
      }
    }
  };

  const consumeNumber = () => {
    if (at() === 0x2b || at() === 0x2d) pos++;
    while (isDigit(at())) pos++;
    if (at() === 0x2e && isDigit(at(1))) {
      pos += 2;
      while (isDigit(at())) pos++;
    }
    if ((at() === 0x45 || at() === 0x65) && (isDigit(at(1)) || ((at(1) === 0x2b || at(1) === 0x2d) && isDigit(at(2))))) {
      pos += isDigit(at(1)) ? 2 : 3;
      while (isDigit(at())) pos++;
    }
  };

  const consumeNumeric = (): { type: CssTokenType; value: string } => {
    consumeNumber();
    if (startsIdent(at(), at(1), at(2))) return { type: "dimension", value: consumeIdentSequence() };
    if (at() === 0x25) {
      pos++;
      return { type: "percentage", value: "" };
    }
    return { type: "number", value: "" };
  };

  const consumeBadUrlRemnants = () => {
    for (;;) {
      const c = at();
      if (c === EOF) return;
      if (c === 0x29) {
        pos++;
        return;
      }
      if (validEscape(c, at(1))) {
        pos++;
        consumeEscape();
      } else {
        pos++;
      }
    }
  };

  const consumeUrl = (): { type: CssTokenType; value: string; unterminated?: boolean } => {
    let value = "";
    while (isWhitespace(at())) pos++;
    for (;;) {
      const c = at();
      if (c === 0x29) {
        pos++;
        return { type: "url", value };
      }
      if (c === EOF) return { type: "url", value, unterminated: true };
      if (isWhitespace(c)) {
        while (isWhitespace(at())) pos++;
        if (at() === 0x29) {
          pos++;
          return { type: "url", value };
        }
        if (at() === EOF) return { type: "url", value, unterminated: true };
        consumeBadUrlRemnants();
        return { type: "bad-url", value: "" };
      }
      if (c === 0x22 || c === 0x27 || c === 0x28 || isNonPrintable(c)) {
        consumeBadUrlRemnants();
        return { type: "bad-url", value: "" };
      }
      if (c === 0x5c) {
        if (validEscape(c, at(1))) {
          pos++;
          value += consumeEscape();
          continue;
        }
        consumeBadUrlRemnants();
        return { type: "bad-url", value: "" };
      }
      value += String.fromCodePoint(c);
      pos++;
    }
  };

  const consumeIdentLike = (): { type: CssTokenType; value: string; unterminated?: boolean } => {
    const name = consumeIdentSequence();
    if (name.toLowerCase() === "url" && at() === 0x28) {
      pos++;
      while (isWhitespace(at()) && isWhitespace(at(1))) pos++;
      const next = at();
      const afterSpace = isWhitespace(next) ? at(1) : next;
      if (afterSpace === 0x22 || afterSpace === 0x27) return { type: "function", value: name };
      return consumeUrl();
    }
    if (at() === 0x28) {
      pos++;
      return { type: "function", value: name };
    }
    return { type: "ident", value: name };
  };

  const consumeString = (ending: number): { type: CssTokenType; value: string; unterminated?: boolean } => {
    let value = "";
    for (;;) {
      const c = at();
      if (c === ending) {
        pos++;
        return { type: "string", value };
      }
      if (c === EOF) return { type: "string", value, unterminated: true };
      if (isNewline(c)) return { type: "bad-string", value: "" };
      if (c === 0x5c) {
        const next = at(1);
        if (next === EOF) {
          pos++;
          continue;
        }
        if (isNewline(next)) {
          pos += 2;
          continue;
        }
        pos++;
        value += consumeEscape();
        continue;
      }
      value += String.fromCodePoint(c);
      pos++;
    }
  };

  const consumeToken = (): Omit<CssToken, "start" | "end"> => {
    const c = at();
    if (c === 0x2f && at(1) === 0x2a) {
      pos += 2;
      for (;;) {
        if (at() === EOF) return { type: "comment", value: "", unterminated: true };
        if (at() === 0x2a && at(1) === 0x2f) {
          pos += 2;
          return { type: "comment", value: "" };
        }
        pos++;
      }
    }
    if (isWhitespace(c)) {
      while (isWhitespace(at())) pos++;
      return { type: "whitespace", value: "" };
    }
    if (c === 0x22 || c === 0x27) {
      pos++;
      return { ...consumeString(c), quote: String.fromCodePoint(c) };
    }
    if (c === 0x23) {
      if (isIdentCode(at(1)) || validEscape(at(1), at(2))) {
        pos++;
        return { type: "hash", value: consumeIdentSequence() };
      }
      pos++;
      return { type: "delim", value: "#" };
    }
    if (c === 0x28 || c === 0x29 || c === 0x5b || c === 0x5d || c === 0x7b || c === 0x7d || c === 0x3b || c === 0x3a || c === 0x2c) {
      pos++;
      return { type: String.fromCodePoint(c) as CssTokenType, value: "" };
    }
    if (c === 0x2b || c === 0x2e) {
      if (startsNumber(c, at(1), at(2))) return consumeNumeric();
      pos++;
      return { type: "delim", value: String.fromCodePoint(c) };
    }
    if (c === 0x2d) {
      if (startsNumber(c, at(1), at(2))) return consumeNumeric();
      if (at(1) === 0x2d && at(2) === 0x3e) {
        pos += 3;
        return { type: "cdc", value: "" };
      }
      if (startsIdent(c, at(1), at(2))) return consumeIdentLike();
      pos++;
      return { type: "delim", value: "-" };
    }
    if (c === 0x3c) {
      if (at(1) === 0x21 && at(2) === 0x2d && at(3) === 0x2d) {
        pos += 4;
        return { type: "cdo", value: "" };
      }
      pos++;
      return { type: "delim", value: "<" };
    }
    if (c === 0x40) {
      if (startsIdent(at(1), at(2), at(3))) {
        pos++;
        return { type: "at-keyword", value: consumeIdentSequence() };
      }
      pos++;
      return { type: "delim", value: "@" };
    }
    if (c === 0x5c) {
      if (validEscape(c, at(1))) return consumeIdentLike();
      pos++;
      return { type: "delim", value: "\\" };
    }
    if (isDigit(c)) return consumeNumeric();
    if (isIdentStart(c)) return consumeIdentLike();
    pos++;
    return { type: "delim", value: String.fromCodePoint(c) };
  };

  const tokens: CssToken[] = [];
  while (pos < codes.length) {
    const start = pos;
    const token = consumeToken();
    tokens.push({ ...token, start: offsets[start], end: offsets[pos] });
  }
  return tokens;
}
