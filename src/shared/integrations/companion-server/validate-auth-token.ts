import type { AuthToken } from "./types";
import { isNumber, isString, objectOf, optional } from "../../validation";

export const isAuthToken = objectOf<AuthToken>({
  appId: isString,
  appVersion: isString,
  appName: isString,
  id: isString,
  token: isString,
  lastUsed: optional(isNumber),
  metadata: objectOf({ version: isNumber }),
});
