import { isArray, isRecord } from "./values.ts";

type CssProperty = { name: string; value: string; important?: boolean; disabled?: boolean };
type CssRule = { origin: string; selectorList?: { text: string }; style?: { cssProperties?: CssProperty[] } };
type CssMatch = { rule: CssRule };
export type CdpTarget = { type: string; url: string; webSocketDebuggerUrl: string };
export type CdpResult = {
  exceptionDetails?: { exception?: { description?: string }; text?: string };
  result?: { value?: unknown };
  root?: { nodeId: number };
  nodeId?: number;
  data?: string;
  matchedCSSRules?: CssMatch[];
  inherited?: { matchedCSSRules?: CssMatch[] }[];
};
export type CdpMessage = { method?: string; params?: Record<string, unknown>; id?: number; result?: CdpResult; error?: { message: string } };

function optional<T>(value: unknown, guard: (value: unknown) => value is T): value is T | undefined {
  return value === undefined || guard(value);
}

function isText(value: unknown): value is string {
  return typeof value === "string";
}
function isNumber(value: unknown): value is number {
  return typeof value === "number";
}
function isBoolean(value: unknown): value is boolean {
  return typeof value === "boolean";
}
function isCssProperty(value: unknown): value is CssProperty {
  return isRecord(value) && isText(value.name) && isText(value.value) && optional(value.important, isBoolean) && optional(value.disabled, isBoolean);
}
function isCssRule(value: unknown): value is CssRule {
  return (
    isRecord(value) &&
    isText(value.origin) &&
    optional(value.selectorList, (entry): entry is { text: string } => isRecord(entry) && isText(entry.text)) &&
    optional(
      value.style,
      (entry): entry is { cssProperties?: CssProperty[] } =>
        isRecord(entry) && optional(entry.cssProperties, (properties): properties is CssProperty[] => isArray(properties) && properties.every(isCssProperty))
    )
  );
}
function isCssMatch(value: unknown): value is CssMatch {
  return isRecord(value) && isCssRule(value.rule);
}
function isMatches(value: unknown): value is CssMatch[] {
  return isArray(value) && value.every(isCssMatch);
}
function isException(value: unknown): value is NonNullable<CdpResult["exceptionDetails"]> {
  return (
    isRecord(value) &&
    optional(value.text, isText) &&
    optional(value.exception, (entry): entry is { description?: string } => isRecord(entry) && optional(entry.description, isText))
  );
}
export function isCdpResult(value: unknown): value is CdpResult {
  return (
    isRecord(value) &&
    optional(value.exceptionDetails, isException) &&
    optional(value.result, isRecord) &&
    optional(value.root, (entry): entry is { nodeId: number } => isRecord(entry) && isNumber(entry.nodeId)) &&
    optional(value.nodeId, isNumber) &&
    optional(value.data, isText) &&
    optional(value.matchedCSSRules, isMatches) &&
    optional(
      value.inherited,
      (entries): entries is { matchedCSSRules?: CssMatch[] }[] =>
        isArray(entries) && entries.every((entry) => isRecord(entry) && optional(entry.matchedCSSRules, isMatches))
    )
  );
}
export function parseCdpMessage(data: unknown): CdpMessage {
  if (typeof data !== "string") throw new Error("CDP message is not text");
  const value: unknown = JSON.parse(data);
  if (
    !isRecord(value) ||
    !optional(value.method, isText) ||
    !optional(value.params, isRecord) ||
    !optional(value.id, isNumber) ||
    !optional(value.result, isCdpResult) ||
    !optional(value.error, (entry): entry is { message: string } => isRecord(entry) && isText(entry.message))
  ) {
    throw new Error("Invalid CDP message");
  }
  return value;
}
export function messageResult(message: CdpMessage): CdpResult {
  if (message.result === undefined) throw new Error("CDP result is missing");
  return message.result;
}
export function cdpTargets(value: unknown): CdpTarget[] {
  if (
    !isArray(value) ||
    !value.every((entry): entry is CdpTarget => isRecord(entry) && isText(entry.type) && isText(entry.url) && isText(entry.webSocketDebuggerUrl))
  ) {
    throw new Error("Invalid CDP target list");
  }
  return value;
}
