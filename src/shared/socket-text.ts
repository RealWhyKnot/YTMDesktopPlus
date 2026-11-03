import type { RawData } from "ws";

export function socketText(data: RawData | string): string {
  if (typeof data === "string") return data;
  if (Buffer.isBuffer(data)) return data.toString("utf8");
  if (Array.isArray(data)) return data.map((part) => part.toString("utf8")).join(",");
  return Object.prototype.toString.call(data);
}
