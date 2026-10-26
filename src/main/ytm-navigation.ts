export const YTM_ORIGIN = "https://music.youtube.com";
export const YTM_SIGN_IN_ORIGINS: readonly string[] = ["https://consent.youtube.com", "https://accounts.google.com"];

// https://www.google.com/supported_domains
// prettier-ignore
const SUPPORTED_GOOGLE_DOMAINS = [".google.com",".google.ad",".google.ae",".google.com.af",".google.com.ag",".google.al",".google.am",".google.co.ao",".google.com.ar",".google.as",".google.at",".google.com.au",".google.az",".google.ba",".google.com.bd",".google.be",".google.bf",".google.bg",".google.com.bh",".google.bi",".google.bj",".google.com.bn",".google.com.bo",".google.com.br",".google.bs",".google.bt",".google.co.bw",".google.by",".google.com.bz",".google.ca",".google.cd",".google.cf",".google.cg",".google.ch",".google.ci",".google.co.ck",".google.cl",".google.cm",".google.cn",".google.com.co",".google.co.cr",".google.com.cu",".google.cv",".google.com.cy",".google.cz",".google.de",".google.dj",".google.dk",".google.dm",".google.com.do",".google.dz",".google.com.ec",".google.ee",".google.com.eg",".google.es",".google.com.et",".google.fi",".google.com.fj",".google.fm",".google.fr",".google.ga",".google.ge",".google.gg",".google.com.gh",".google.com.gi",".google.gl",".google.gm",".google.gr",".google.com.gt",".google.gy",".google.com.hk",".google.hn",".google.hr",".google.ht",".google.hu",".google.co.id",".google.ie",".google.co.il",".google.im",".google.co.in",".google.iq",".google.is",".google.it",".google.je",".google.com.jm",".google.jo",".google.co.jp",".google.co.ke",".google.com.kh",".google.ki",".google.kg",".google.co.kr",".google.com.kw",".google.kz",".google.la",".google.com.lb",".google.li",".google.lk",".google.co.ls",".google.lt",".google.lu",".google.lv",".google.com.ly",".google.co.ma",".google.md",".google.me",".google.mg",".google.mk",".google.ml",".google.com.mm",".google.mn",".google.com.mt",".google.mu",".google.mv",".google.mw",".google.com.mx",".google.com.my",".google.co.mz",".google.com.na",".google.com.ng",".google.com.ni",".google.ne",".google.nl",".google.no",".google.com.np",".google.nr",".google.nu",".google.co.nz",".google.com.om",".google.com.pa",".google.com.pe",".google.com.pg",".google.com.ph",".google.com.pk",".google.pl",".google.pn",".google.com.pr",".google.ps",".google.pt",".google.com.py",".google.com.qa",".google.ro",".google.ru",".google.rw",".google.com.sa",".google.com.sb",".google.sc",".google.se",".google.com.sg",".google.sh",".google.si",".google.sk",".google.com.sl",".google.sn",".google.so",".google.sm",".google.sr",".google.st",".google.com.sv",".google.td",".google.tg",".google.co.th",".google.com.tj",".google.tl",".google.tm",".google.tn",".google.to",".google.com.tr",".google.tt",".google.com.tw",".google.co.tz",".google.com.ua",".google.co.ug",".google.co.uk",".google.com.uy",".google.co.uz",".google.com.vc",".google.co.ve",".google.co.vi",".google.com.vn",".google.vu",".google.ws",".google.rs",".google.co.za",".google.co.zm",".google.co.zw",".google.cat"];

const GOOGLE_ACCOUNTS_HOSTS = new Set(SUPPORTED_GOOGLE_DOMAINS.map(domain => `accounts${domain}`));
const IN_VIEW_HOSTS = new Set(["music.youtube.com", "consent.youtube.com", "accounts.youtube.com"]);
const YOUTUBE_HOSTS = new Set(["www.youtube.com", "youtube.com"]);
const YOUTUBE_IN_VIEW_PATHS = new Set(["/signin", "/premium", "/musicpremium", "/signin_prompt"]);
const PREMIUM_PATHS = new Set(["/premium", "/musicpremium"]);
const EXTERNAL_DOMAINS = ["google.com", "youtube.com"];

export type YtmNavigation = "allow" | "openExternal" | "block";

function parseUrl(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

function isPlainHttps(url: URL): boolean {
  return url.protocol === "https:" && url.username === "" && url.password === "" && url.port === "";
}

function hostIsWithin(hostname: string, domain: string): boolean {
  return hostname === domain || hostname.endsWith(`.${domain}`);
}

export function urlIsGoogleAccountsDomain(url: URL): boolean {
  return isPlainHttps(url) && GOOGLE_ACCOUNTS_HOSTS.has(url.hostname);
}

function isAllowedInView(url: URL): boolean {
  if (!isPlainHttps(url)) return false;
  if (IN_VIEW_HOSTS.has(url.hostname)) return true;
  if (YOUTUBE_HOSTS.has(url.hostname) && YOUTUBE_IN_VIEW_PATHS.has(url.pathname)) return true;
  return urlIsGoogleAccountsDomain(url);
}

function isExternallyOpenable(url: URL): boolean {
  return isPlainHttps(url) && EXTERNAL_DOMAINS.some(domain => hostIsWithin(url.hostname, domain));
}

export function canOpenExternally(url: string): boolean {
  const parsed = parseUrl(url);
  return parsed !== null && isExternallyOpenable(parsed);
}

export function classifyYtmNavigation(url: string): YtmNavigation {
  const parsed = parseUrl(url);
  if (parsed === null) return "block";
  if (isAllowedInView(parsed)) return "allow";
  return isExternallyOpenable(parsed) ? "openExternal" : "block";
}

export function isPremiumRequiredRedirect(url: string): boolean {
  const parsed = parseUrl(url);
  return parsed !== null && isPlainHttps(parsed) && YOUTUBE_HOSTS.has(parsed.hostname) && PREMIUM_PATHS.has(parsed.pathname);
}

export function isYtmOrigin(url: string, origins: readonly string[] = [YTM_ORIGIN]): boolean {
  const parsed = parseUrl(url);
  return parsed !== null && isPlainHttps(parsed) && origins.includes(parsed.origin);
}
