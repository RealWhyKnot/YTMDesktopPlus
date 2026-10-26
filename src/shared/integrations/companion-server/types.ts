export type AuthToken = {
  appId: string;
  appVersion: string;
  appName: string;
  id: string;
  token: string;
  lastUsed?: number;
  metadata: {
    version: number;
  };
};
