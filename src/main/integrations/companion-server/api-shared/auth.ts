import crypto from "crypto";
import { safeStorage } from "electron";
import log from "electron-log";
import Conf from "conf";
import { FastifyReply, FastifyRequest, HookHandlerDoneFunction } from "fastify";
import { StoreSchema } from "../../../../shared/store/schema";
import { AuthToken } from "../../../../shared/integrations/companion-server/types";

const temporaryCodeMap: { [code: string]: { appId: string; appVersion: string; appName: string } } = {};
let decryptedAuthTokens: { encrypted: string | null; tokens: AuthToken[] } | undefined;

export const LAST_USED_RESOLUTION_MS = 60 * 60 * 1000;
export const FAILED_AUTH_LIMIT = 20;
export const FAILED_AUTH_WINDOW_MS = 60 * 1000;
export const FAILED_AUTH_LOCKOUT_MS = 60 * 1000;

const failedAuthAttempts = new Map<string, { count: number; windowStart: number; lockedUntil: number }>();

export function getAuthTokens(store: Conf<StoreSchema>): AuthToken[] {
  const encrypted = store.get("integrations.companionServerAuthTokens");
  if (!decryptedAuthTokens || decryptedAuthTokens.encrypted !== encrypted) {
    let tokens: AuthToken[];
    try {
      tokens = JSON.parse(safeStorage.decryptString(Buffer.from(encrypted, "hex")));
    } catch {
      tokens = [];
    }
    decryptedAuthTokens = { encrypted, tokens };
  }
  return decryptedAuthTokens.tokens;
}

async function getUnusedCode() {
  return new Promise<string>(resolve => {
    let code;
    const generateStart = Date.now();
    // Because of this setInterval it does take 250ms before it executes which delays everything by 250ms
    const interval = setInterval(() => {
      // Failsafe timeout bail. It could be that every code is exhausted or we simply didn't find a code fast enough
      if (Date.now() - generateStart > 3 * 1000) {
        clearInterval(interval);
        resolve(null);
      }

      code = `${crypto.randomInt(0, 10)}${crypto.randomInt(0, 10)}${crypto.randomInt(0, 10)}${crypto.randomInt(0, 10)}`;
      if (!temporaryCodeMap[code]) {
        clearInterval(interval);
        resolve(code);
      }
    }, 250);
  });
}

export async function getTemporaryAuthCode(appId: string, appVersion: string, appName: string) {
  const code = await getUnusedCode();
  if (code) {
    temporaryCodeMap[code] = {
      appId,
      appVersion,
      appName
    };
    setTimeout(() => {
      delete temporaryCodeMap[code];
    }, 60 * 1000);
  }
  return code;
}

export function getIsTemporaryAuthCodeValidAndRemove(appId: string, code: string) {
  if (temporaryCodeMap[code]) {
    if (temporaryCodeMap[code].appId === appId) {
      const data = temporaryCodeMap[code];
      delete temporaryCodeMap[code];
      return data;
    }
  }

  return false;
}

export function createAuthToken(store: Conf<StoreSchema>, appId: string, appVersion: string, appName: string) {
  const authTokens = [...getAuthTokens(store)];
  const currentTokenIndex = authTokens.findIndex(token => token.appId === appId);
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
      version: 1
    }
  });

  store.set("integrations.companionServerAuthTokens", safeStorage.encryptString(JSON.stringify(authTokens)).toString("hex"));

  return token;
}

function touchAuthToken(store: Conf<StoreSchema>, id: string, now: number) {
  const tokens = getAuthTokens(store);
  const current = tokens.find(token => token.id === id);
  if (!current || (typeof current.lastUsed === "number" && now - current.lastUsed < LAST_USED_RESOLUTION_MS)) return;

  const updated = tokens.map(token => (token.id === id ? { ...token, lastUsed: now } : token));
  try {
    const encrypted = safeStorage.encryptString(JSON.stringify(updated)).toString("hex");
    store.set("integrations.companionServerAuthTokens", encrypted);
    decryptedAuthTokens = { encrypted, tokens: updated };
  } catch (error) {
    log.warn("Could not record when a companion token was last used", error);
  }
}

export function isAuthValid(store: Conf<StoreSchema>, authToken: string): [boolean, string] {
  if (!authToken) return [false, null];

  const authTokenHash = crypto.createHash("sha256").update(authToken).digest("hex");

  let validSession = false;
  let id = null;
  for (const authSession of getAuthTokens(store)) {
    if (authSession.token == authTokenHash) {
      id = authSession.id;
      validSession = true;
      break;
    }
  }

  if (validSession) {
    touchAuthToken(store, id, Date.now());
    return [true, id];
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

export function rateLimitKey(store: Conf<StoreSchema>, request: FastifyRequest) {
  const [validSession, tokenId] = isAuthValid(store, request.headers.authorization);
  return validSession ? `token:${tokenId}` : `ip:${request.ip}`;
}

export function isAuthValidMiddleware(store: Conf<StoreSchema>, request: FastifyRequest, response: FastifyReply, next: HookHandlerDoneFunction) {
  if (isAuthLockedOut(request.ip)) {
    response.code(429);
    response.send({
      error: "TOO_MANY_FAILED_ATTEMPTS"
    });
    return;
  }

  const authToken = request.headers.authorization;
  if (!authToken) {
    recordFailedAuth(request.ip);
    response.code(401);
    response.send({
      error: "UNAUTHORIZED"
    });
    return;
  }

  const [validSession, tokenId] = isAuthValid(store, authToken);

  if (validSession) {
    request.authId = tokenId;
    next();
  } else {
    recordFailedAuth(request.ip);
    response.code(401);
    response.send({
      error: "UNAUTHORIZED"
    });
  }
}
