import { describe, expect, it } from "vitest";
import { hostnameFromHostHeader, isAllowedHost, isAllowedOrigin } from "../src/main/integrations/companion-server/host-check";

const interfaces = () => ["127.0.0.1", "192.168.1.20", "[fe80::1]"];

describe("hostnameFromHostHeader", () => {
  it.each([
    ["localhost", "localhost"],
    ["LocalHost:9863", "localhost"],
    ["127.0.0.1:9863", "127.0.0.1"],
    ["[::1]", "[::1]"],
    ["[::1]:9863", "[::1]"]
  ])("reads %s as %s", (host, expected) => {
    expect(hostnameFromHostHeader(host)).toBe(expected);
  });

  it.each([undefined, "", ":9863", "localhost:abc", "localhost:9863:1", "[::1", "[::1]x", "localhost:9863@evil.example"])("rejects %s", host => {
    expect(hostnameFromHostHeader(host)).toBeNull();
  });
});

describe("isAllowedHost", () => {
  it.each(["localhost", "localhost:9863", "127.0.0.1", "[::1]:9863"])("always allows loopback %s", host => {
    expect(isAllowedHost(host, false, interfaces)).toBe(true);
  });

  it("allows this machine's interface addresses only with LAN access", () => {
    expect(isAllowedHost("192.168.1.20:9863", false, interfaces)).toBe(false);
    expect(isAllowedHost("192.168.1.20:9863", true, interfaces)).toBe(true);
    expect(isAllowedHost("[fe80::1]:9863", true, interfaces)).toBe(true);
  });

  it.each(["evil.example", "evil.example:9863", "192.168.1.21", "localhost.evil.example"])("rejects %s even with LAN access", host => {
    expect(isAllowedHost(host, true, interfaces)).toBe(false);
  });
});

describe("isAllowedOrigin", () => {
  it("allows clients that send no Origin", () => {
    expect(isAllowedOrigin(undefined, "localhost:9863", false)).toBe(true);
  });

  it("allows a same-origin Origin", () => {
    expect(isAllowedOrigin("http://localhost:9863", "localhost:9863", false)).toBe(true);
    expect(isAllowedOrigin("http://192.168.1.20:9863", "192.168.1.20:9863", false)).toBe(true);
  });

  it.each(["http://evil.example", "http://localhost:3000", "null", "file://", "chrome-extension://abc"])("rejects %s without the CORS wildcard", origin => {
    expect(isAllowedOrigin(origin, "localhost:9863", false)).toBe(false);
  });

  it("allows any Origin with the CORS wildcard", () => {
    expect(isAllowedOrigin("http://evil.example", "localhost:9863", true)).toBe(true);
  });
});
