import os from "node:os";

const LOOPBACK_HOSTS = ["localhost", "127.0.0.1", "[::1]"];
const PORT_SUFFIX = /^:\d{1,5}$/;

export function hostnameFromHostHeader(host: string | undefined): string | null {
  if (!host) return null;
  const value = host.trim().toLowerCase();

  let name: string;
  let rest: string;
  if (value.startsWith("[")) {
    const end = value.indexOf("]");
    if (end < 0) return null;
    name = value.slice(0, end + 1);
    rest = value.slice(end + 1);
  } else {
    const colon = value.indexOf(":");
    name = colon < 0 ? value : value.slice(0, colon);
    rest = colon < 0 ? "" : value.slice(colon);
  }

  if (name === "" || (rest !== "" && !PORT_SUFFIX.test(rest))) return null;
  return name;
}

export function localInterfaceHosts(): string[] {
  const hosts: string[] = [];
  for (const addresses of Object.values(os.networkInterfaces())) {
    for (const address of addresses ?? []) {
      hosts.push(address.family === "IPv6" ? `[${address.address.toLowerCase()}]` : address.address);
    }
  }
  return hosts;
}

export function isAllowedHost(host: string | undefined, allowLan: boolean, interfaceHosts: () => string[] = localInterfaceHosts): boolean {
  const name = hostnameFromHostHeader(host);
  if (!name) return false;
  if (LOOPBACK_HOSTS.includes(name)) return true;
  return allowLan && interfaceHosts().includes(name);
}

export function isAllowedOrigin(origin: string | undefined, host: string | undefined, corsWildcard: boolean): boolean {
  if (origin === undefined || corsWildcard) return true;

  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  return host !== undefined && url.host === host.trim().toLowerCase();
}
