import { requireValue } from "./require-value";
import { AddonManager } from "../../src/main/addons/manager";
import type { AddonContext } from "~shared/addons/sdk";
import { makeManifest as manifest } from "./fake-addon-context";
import { fakeServices } from "./fake-services";

export async function bootWithContext(fixture: ReturnType<typeof fakeServices>, id = "sample") {
  let ctx: AddonContext | undefined;
  const manager = new AddonManager(fixture.services);
  manager.registerBundled([
    {
      manifest: manifest({ id, defaultEnabled: true }),
      activate: (context) => {
        ctx = context;
        return undefined;
      },
    },
  ]);
  await manager.boot();
  return { manager, ctx: requireValue<AddonContext>(ctx) };
}
