import cypto from "crypto";
import type { LastfmRequestBody } from "./schemas";

export function createQueryString(params: Partial<LastfmRequestBody>, apiSig: string) {
  const data = [];
  params.api_sig = apiSig;

  for (const [key, value] of Object.entries(params)) {
    if (!value) {
      continue;
    }

    data.push(`${encodeURIComponent(key)}=${encodeURIComponent(value.toString())}`);
  }
  return data.join("&");
}

export function createBody(params: Partial<LastfmRequestBody>) {
  const data = new URLSearchParams();
  const entries: [string, LastfmRequestBody[keyof LastfmRequestBody]][] = Object.entries(params);
  for (const [key, value] of entries) {
    if (value === null || value === undefined) {
      continue;
    }

    data.append(key, value.toString());
  }
  return data;
}

export function createApiSig(params: Partial<LastfmRequestBody>, secret: string) {
  const values = new Map(Object.entries(params));
  const keys = [...values.keys()].sort();
  const data = [];

  for (const key of keys) {
    if (key === "format" || key === "callback") {
      continue;
    }

    const value = values.get(key);
    if (!value) {
      continue;
    }

    data.push(`${key}${value.toString()}`);
  }

  data.push(secret);
  return md5(data.join(""));
}

function md5(string: string): string {
  return cypto.createHash("md5").update(string).digest("hex");
}
