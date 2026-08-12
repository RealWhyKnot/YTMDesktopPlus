import log from "electron-log";
import type { StoreSchema } from "../../shared/store/schema";

export interface IntegrationRegistration {
  label: string;
  isEnabled(state: Readonly<StoreSchema>): boolean;
  integration: { enable(): void; disable(): void };
  // Called on every settings change while enabled, and before enable at boot,
  // so integrations always hold the current view reference.
  provide?(): void;
}

export function syncIntegrations(registrations: IntegrationRegistration[], newState: Readonly<StoreSchema>, oldState: Readonly<StoreSchema>): void {
  for (const registration of registrations) {
    const enabled = registration.isEnabled(newState);
    const wasEnabled = registration.isEnabled(oldState);

    if (enabled) registration.provide?.();

    if (enabled && !wasEnabled) {
      registration.integration.enable();
      log.info(`Integration enabled: ${registration.label}`);
    } else if (!enabled && wasEnabled) {
      registration.integration.disable();
      log.info(`Integration disabled: ${registration.label}`);
    }
  }
}

export function enableIntegrationsAtBoot(registrations: IntegrationRegistration[], state: Readonly<StoreSchema>): void {
  for (const registration of registrations) {
    if (!registration.isEnabled(state)) continue;

    registration.provide?.();
    registration.integration.enable();
    log.info(`Integration enabled: ${registration.label}`);
  }
}
