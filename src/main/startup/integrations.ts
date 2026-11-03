import { type IntegrationRegistration } from "../integrations/lifecycle";

import type { MainContext } from "../index";

export function createIntegrationRegistrations(context: MainContext): IntegrationRegistration[] {
  return [
    {
      label: "Now playing notifications",
      isEnabled: (state) => state.general.showNotificationOnSongChange,
      integration: context.nowPlayingNotifications,
    },
    {
      label: "Ratio volume",
      isEnabled: (state) => state.playback.ratioVolume,
      integration: context.ratioVolume,
      provide: () => context.ratioVolume.provide(context.ytmView),
    },
    {
      label: "Prevent idle pause",
      isEnabled: (state) => state.playback.preventIdlePause,
      integration: context.nonStop,
      provide: () => context.nonStop.provide(context.ytmView),
    },
    {
      label: "Companion server",
      isEnabled: (state) => state.integrations.companionServerEnabled,
      integration: context.companionServer,
      provide: () => context.companionServer.provide(context.store, context.memoryStore, context.ytmView),
    },
    {
      label: "Discord presence",
      isEnabled: (state) => state.integrations.discordPresenceEnabled,
      integration: context.discordPresence,
      provide: () => context.discordPresence.provide(context.store, context.memoryStore),
    },
    {
      label: "Last.fm",
      isEnabled: (state) => state.integrations.lastFMEnabled,
      integration: context.lastFMScrobbler,
      provide: () => context.lastFMScrobbler.provide(context.store, context.memoryStore),
    },
    {
      label: "Listen along",
      isEnabled: (state) => state.integrations.listenAlongEnabled,
      integration: context.listenAlong,
      provide: () => context.listenAlong.provide(context.store, context.memoryStore),
    },
  ];
}
