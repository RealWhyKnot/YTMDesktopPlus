export type UpdateClient = {
  isPackaged: boolean;
  platform: NodeJS.Platform;
  isLocalBuild: boolean;
  isUpdatesDisabled: boolean;
  isTestClient: boolean;
};

function isReleaseClient(client: UpdateClient): boolean {
  return client.isPackaged && !client.isLocalBuild && !client.isUpdatesDisabled && !client.isTestClient;
}

export function canSelfUpdate(client: UpdateClient): boolean {
  return isReleaseClient(client) && client.platform === "win32";
}

export function canShowUpdateNotice(client: UpdateClient): boolean {
  return isReleaseClient(client) && client.platform === "linux";
}
