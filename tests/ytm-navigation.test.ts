import { describe, expect, it } from "vitest";
import {
  canOpenExternally,
  classifyYtmNavigation,
  isPremiumRequiredRedirect,
  isYtmOrigin,
  urlIsGoogleAccountsDomain,
  YTM_SIGN_IN_ORIGINS
} from "../src/main/ytm-navigation";

const SUPPORTED_SAMPLE = [
  "google.com",
  "google.co.uk",
  "google.de",
  "google.com.au",
  "google.co.jp",
  "google.com.br",
  "google.co.in",
  "google.cat",
  "google.rs",
  "google.co.za"
];

describe("classifyYtmNavigation", () => {
  it("keeps the YouTube Music and sign-in flows in the view", () => {
    for (const url of [
      "https://music.youtube.com/",
      "https://music.youtube.com/watch?v=abc&list=RD",
      "https://consent.youtube.com/m?continue=https%3A%2F%2Fmusic.youtube.com",
      "https://accounts.youtube.com/accounts/SetSID",
      "https://www.youtube.com/signin?action_handle_signin=true",
      "https://youtube.com/signin",
      "https://www.youtube.com/premium",
      "https://youtube.com/musicpremium",
      "https://www.youtube.com/signin_prompt",
      "https://MUSIC.YouTube.COM/library"
    ]) {
      expect(classifyYtmNavigation(url), url).toBe("allow");
    }
  });

  it("keeps accounts.google on every supported domain in the view", () => {
    for (const domain of SUPPORTED_SAMPLE) {
      expect(classifyYtmNavigation(`https://accounts.${domain}/ServiceLogin`), domain).toBe("allow");
    }
  });

  it("sends other YouTube and Google https pages to the browser", () => {
    for (const url of [
      "https://www.youtube.com/watch?v=abc",
      "https://youtube.com/channel/UC123",
      "https://support.google.com/youtubemusic",
      "https://google.com/",
      "https://policies.google.com/privacy"
    ]) {
      expect(classifyYtmNavigation(url), url).toBe("openExternal");
    }
  });

  it("blocks hosts that only look like YouTube or Google", () => {
    for (const url of [
      "https://evil.com/",
      "https://youtube.com.evil.com/",
      "https://notyoutube.com/",
      "https://evilgoogle.com/",
      "https://youtube.com@evil.com/",
      "https://music.youtube.com@evil.com/",
      "https://evil.com\\@youtube.com/",
      "https://evil.com#@music.youtube.com",
      "https://music.youtube.com./",
      "https://youtube.com./watch",
      "https://xn--yutube-wqf.com/",
      "https://yоutube.com/",
      "https://music.yоutube.com/"
    ]) {
      expect(classifyYtmNavigation(url), url).toBe("block");
    }
  });

  it("blocks every scheme other than https", () => {
    for (const url of [
      "ms-officecmd://youtube.com/x",
      "ms-officecmd://music.youtube.com/",
      "search-ms://youtube.com/",
      "file://youtube.com/c$/Windows",
      "javascript:alert(1)//youtube.com",
      "data:text/html,<p>youtube.com</p>",
      "http://music.youtube.com/",
      "http://www.youtube.com/watch?v=abc",
      "ftp://youtube.com/",
      "about:blank"
    ]) {
      expect(classifyYtmNavigation(url), url).toBe("block");
    }
  });

  it("blocks userinfo and odd ports on allowed hosts", () => {
    expect(classifyYtmNavigation("https://user:pass@music.youtube.com/")).toBe("block");
    expect(classifyYtmNavigation("https://user@youtube.com/watch")).toBe("block");
    expect(classifyYtmNavigation("https://music.youtube.com:8443/")).toBe("block");
    expect(classifyYtmNavigation("https://music.youtube.com:443/")).toBe("allow");
  });

  it("sends youtube.com paths that only look like the sign-in ones to the browser", () => {
    expect(classifyYtmNavigation("https://www.youtube.com/signin/extra")).toBe("openExternal");
    expect(classifyYtmNavigation("https://m.youtube.com/signin")).toBe("openExternal");
  });

  it("blocks text that is not a URL instead of throwing", () => {
    expect(classifyYtmNavigation("")).toBe("block");
    expect(classifyYtmNavigation("not a url")).toBe("block");
    expect(classifyYtmNavigation("https://")).toBe("block");
  });
});

describe("urlIsGoogleAccountsDomain", () => {
  it("matches accounts.google exactly", () => {
    for (const domain of SUPPORTED_SAMPLE) {
      expect(urlIsGoogleAccountsDomain(new URL(`https://accounts.${domain}/`)), domain).toBe(true);
    }
  });

  it("rejects hosts that contain accounts.google somewhere else", () => {
    for (const url of [
      "https://accounts.google.comaccounts.evil.com/",
      "https://accounts.evil.comaccounts.google.com/",
      "https://myaccounts.google.com/",
      "https://evil.accounts.google.com/",
      "https://accounts.google.com.evil.com/",
      "https://accounts.google.example/",
      "https://accounts.google.com./",
      "http://accounts.google.com/",
      "https://accounts.google.com@evil.com/"
    ]) {
      expect(urlIsGoogleAccountsDomain(new URL(url)), url).toBe(false);
    }
  });
});

describe("canOpenExternally", () => {
  it("allows https YouTube and Google pages by exact host or dot suffix", () => {
    expect(canOpenExternally("https://youtube.com/")).toBe(true);
    expect(canOpenExternally("https://www.youtube.com/watch?v=1")).toBe(true);
    expect(canOpenExternally("https://support.google.com/")).toBe(true);
  });

  it("refuses other schemes and lookalike hosts", () => {
    for (const url of [
      "ms-officecmd://youtube.com/x",
      "http://youtube.com/",
      "https://youtube.com.evil.com/",
      "https://fakeyoutube.com/",
      "https://youtube.com@evil.com/",
      "https://google.co.uk/",
      "garbage"
    ]) {
      expect(canOpenExternally(url), url).toBe(false);
    }
  });
});

describe("isPremiumRequiredRedirect", () => {
  it("spots the premium pages on youtube.com", () => {
    expect(isPremiumRequiredRedirect("https://www.youtube.com/premium")).toBe(true);
    expect(isPremiumRequiredRedirect("https://youtube.com/musicpremium?x=1")).toBe(true);
  });

  it("ignores everything else", () => {
    expect(isPremiumRequiredRedirect("https://music.youtube.com/premium")).toBe(false);
    expect(isPremiumRequiredRedirect("https://www.youtube.com/signin")).toBe(false);
    expect(isPremiumRequiredRedirect("https://www.youtube.com.evil.com/premium")).toBe(false);
    expect(isPremiumRequiredRedirect("not a url")).toBe(false);
  });
});

describe("isYtmOrigin", () => {
  it("accepts only the YouTube Music origin by default", () => {
    expect(isYtmOrigin("https://music.youtube.com/watch?v=1")).toBe(true);
    expect(isYtmOrigin("https://consent.youtube.com/")).toBe(false);
    expect(isYtmOrigin("https://music.youtube.com.evil.com/")).toBe(false);
    expect(isYtmOrigin("http://music.youtube.com/")).toBe(false);
    expect(isYtmOrigin("")).toBe(false);
  });

  it("accepts the sign-in pages when asked to", () => {
    expect(isYtmOrigin("https://consent.youtube.com/m", YTM_SIGN_IN_ORIGINS)).toBe(true);
    expect(isYtmOrigin("https://accounts.google.com/ServiceLogin", YTM_SIGN_IN_ORIGINS)).toBe(true);
    expect(isYtmOrigin("https://accounts.google.co.uk/", YTM_SIGN_IN_ORIGINS)).toBe(false);
  });
});
