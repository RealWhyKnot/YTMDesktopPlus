import crypto from "crypto";
import { safeStorage } from "electron";
import log from "electron-log";
import { type FastifyReply, type FastifyRequest, type HookHandlerDoneFunction } from "fastify";
import { type AuthToken } from "../../../../shared/integrations/companion-server/types";

type AuthTokenStore = {
  get(key: "integrations.companionServerAuthTokens"): string | null | undefined;
  set(key: "integrations.companionServerAuthTokens", value: string): void;
};

const temporaryCodeMap = new Map<string, { appId: string; appVersion: string; appName: string }>();
let decryptedAuthTokens: { encrypted: string | null | undefined; tokens: AuthToken[] } | undefined;

export const LAST_USED_RESOLUTION_MS = 60 * 60 * 1000;
export const FAILED_AUTH_LIMIT = 20;
export const FAILED_AUTH_WINDOW_MS = 60 * 1000;
export const FAILED_AUTH_LOCKOUT_MS = 60 * 1000;

const failedAuthAttempts = new Map<string, { count: number; windowStart: number; lockedUntil: number }>();

function isAuthToken(value: unknown): value is AuthToken {
  return (
    typeof value === "object" &&
    value !== null &&
    "appId" in value &&
    typeof value.appId === "string" &&
    "appVersion" in value &&
    typeof value.appVersion === "string" &&
    "appName" in value &&
    typeof value.appName === "string" &&
    "id" in value &&
    typeof value.id === "string" &&
    "token" in value &&
    typeof value.token === "string" &&
    (!("lastUsed" in value) || value.lastUsed === undefined || typeof value.lastUsed === "number") &&
    "metadata" in value &&
    typeof value.metadata === "object" &&
    value.metadata !== null &&
    "version" in value.metadata &&
    typeof value.metadata.version === "number"
  );
}

export function getAuthTokens(store: AuthTokenStore): AuthToken[] {
  const encrypted = store.get("integrations.companionServerAuthTokens");
  if (decryptedAuthTokens?.encrypted !== encrypted || decryptedAuthTokens === undefined) {
    let tokens: AuthToken[];
    try {
      if (encrypted === undefined) throw new TypeError("Auth tokens are missing");
      const value: unknown = encrypted === null ? [] : JSON.parse(safeStorage.decryptString(Buffer.from(encrypted, "hex")));
      tokens = Array.isArray(value) ? value.filter(isAuthToken) : [];
    } catch {
      tokens = [];
    }
    decryptedAuthTokens = { encrypted, tokens };
  }
  return decryptedAuthTokens.tokens;
}

async function getUnusedCode() {
  return new Promise<string | null>((resolve) => {
    let code;
    const generateStart = Date.now();

    const interval = setInterval(() => {
      if (Date.now() - generateStart > 3 * 1000) {
        clearInterval(interval);
        resolve(null);
      }

      code = `${crypto.randomInt(0, 10)}${crypto.randomInt(0, 10)}${crypto.randomInt(0, 10)}${crypto.randomInt(0, 10)}`;
      if (!temporaryCodeMap.has(code)) {
        clearInterval(interval);
        resolve(code);
      }
    }, 250);
  });
}

export async function getTemporaryAuthCode(appId: string, appVersion: string, appName: string) {
  const code = await getUnusedCode();
  if (code) {
    temporaryCodeMap.set(code, {
      appId,
      appVersion,
      appName,
    });
    setTimeout(() => {
      temporaryCodeMap.delete(code);
    }, 60 * 1000);
  }
  return code;
}

export function getIsTemporaryAuthCodeValidAndRemove(appId: string, code: string) {
  const data = temporaryCodeMap.get(code);
  if (data?.appId === appId) {
    temporaryCodeMap.delete(code);
    return data;
  }

  return false;
}

export function createAuthToken(store: AuthTokenStore, appId: string, appVersion: string, appName: string) {
  const authTokens = [...getAuthTokens(store)];
  const currentTokenIndex = authTokens.findIndex((token) => token.appId === appId);
  if (currentTokenIndex > -1) {
    authTokens.splice(currentTokenIndex, 1);
  }

  const token = crypto.randomBytes(256).toString("hex");
  const tokenId = crypto.randomUUID();
  authTokens.push({
    appId,
    appName,
    appVersion,
    id: tokenId,
    token: crypto.createHash("sha256").update(token).digest("hex"),
    lastUsed: Date.now(),
    metadata: {
      version: 1,
    },
  });

  store.set("integrations.companionServerAuthTokens", safeStorage.encryptString(JSON.stringify(authTokens)).toString("hex"));

  return token;
}

function touchAuthToken(store: AuthTokenStore, id: string, now: number) {
  const tokens = getAuthTokens(store);
  const current = tokens.find((token) => token.id === id);
  if (!current || (typeof current.lastUsed === "number" && now - current.lastUsed < LAST_USED_RESOLUTION_MS)) return;

  const updated = tokens.map((token) => (token.id === id ? { ...token, lastUsed: now } : token));
  try {
    const encrypted = safeStorage.encryptString(JSON.stringify(updated)).toString("hex");
    store.set("integrations.companionServerAuthTokens", encrypted);
    decryptedAuthTokens = { encrypted, tokens: updated };
  } catch (error) {
    log.warn("Could not record when a companion token was last used", error);
  }
}

export function isAuthValid(store: AuthTokenStore, authToken: string | undefined): [true, string] | [false, null] {
  if (!authToken) return [false, null];
  const authTokenHash = crypto.createHash("sha256").update(authToken).digest("hex");
  for (const authSession of getAuthTokens(store)) {
    if (authSession.token === authTokenHash) {
      touchAuthToken(store, authSession.id, Date.now());
      return [true, authSession.id];
    }
  }
  return [false, null];
}

function isLoopbackAddress(ip: string) {
  return ip === "::1" || ip.startsWith("127.") || ip.startsWith("::ffff:127.");
}

export function isAuthLockedOut(ip: string, now = Date.now()) {
  const entry = failedAuthAttempts.get(ip);
  return entry !== undefined && entry.lockedUntil > now;
}

export function recordFailedAuth(ip: string, now = Date.now()) {
  if (!ip || isLoopbackAddress(ip)) return;

  for (const [key, entry] of failedAuthAttempts) {
    if (entry.lockedUntil <= now && now - entry.windowStart >= FAILED_AUTH_WINDOW_MS) failedAuthAttempts.delete(key);
  }

  let entry = failedAuthAttempts.get(ip);
  if (!entry || now - entry.windowStart >= FAILED_AUTH_WINDOW_MS) {
    entry = { count: 0, windowStart: now, lockedUntil: entry?.lockedUntil ?? 0 };
    failedAuthAttempts.set(ip, entry);
  }

  entry.count++;
  if (entry.count >= FAILED_AUTH_LIMIT) {
    entry.lockedUntil = now + FAILED_AUTH_LOCKOUT_MS;
  }
}

export function clearFailedAuth(ip: string) {
  failedAuthAttempts.delete(ip);
}

export function rateLimitKey(store: AuthTokenStore, request: FastifyRequest) {
  const [isValidSession, tokenId] = isAuthValid(store, request.headers.authorization);
  return isValidSession ? `token:${tokenId}` : `ip:${request.ip}`;
}

export function isAuthValidMiddleware(store: AuthTokenStore, request: FastifyRequest, response: FastifyReply, next: HookHandlerDoneFunction) {
  if (isAuthLockedOut(request.ip)) {
    response.code(429);
    response.send({
      error: "TOO_MANY_FAILED_ATTEMPTS",
    });
    return;
  }

  const authToken = request.headers.authorization;
  if (!authToken) {
    recordFailedAuth(request.ip);
    response.code(401);
    response.send({
      error: "UNAUTHORIZED",
    });
    return;
  }

  const [isValidSession, tokenId] = isAuthValid(store, authToken);

  if (isValidSession) {
    Object.assign(request, { authId: tokenId });
    next();
  } else {
    recordFailedAuth(request.ip);
    response.code(401);
    response.send({
      error: "UNAUTHORIZED",
    });
  }
}
