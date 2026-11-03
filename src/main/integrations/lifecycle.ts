import log from "electron-log";
import type { Integration } from "./integration";
import type { StoreSchema } from "../../shared/store/schema";

export type IntegrationRegistration = {
  label: string;
  isEnabled(state: Readonly<StoreSchema>): boolean;
  integration: Pick<Integration, "enable" | "disable">;

  provide?(): void;
};

export function syncIntegrations(registrations: IntegrationRegistration[], newState: Readonly<StoreSchema>, oldState: Readonly<StoreSchema>): void {
  for (const registration of registrations) {
    const isEnabled = registration.isEnabled(newState);
    const wasEnabled = registration.isEnabled(oldState);

    if (isEnabled) registration.provide?.();

    if (isEnabled && !wasEnabled) {
      const enabling = registration.integration.enable();
      if (enabling !== undefined) void enabling.catch((error: unknown) => log.error(`Integration failed to enable: ${registration.label}`, error));
      log.info(`Integration enabled: ${registration.label}`);
    } else if (!isEnabled && wasEnabled) {
      const disabling = registration.integration.disable();
      if (disabling !== undefined) void disabling.catch((error: unknown) => log.error(`Integration failed to disable: ${registration.label}`, error));
      log.info(`Integration disabled: ${registration.label}`);
    }
  }
}

export function enableIntegrationsAtBoot(registrations: IntegrationRegistration[], state: Readonly<StoreSchema>): void {
  for (const registration of registrations) {
    if (!registration.isEnabled(state)) continue;

    registration.provide?.();
    const enabling = registration.integration.enable();
    if (enabling !== undefined) void enabling.catch((error: unknown) => log.error(`Integration failed to enable: ${registration.label}`, error));
    log.info(`Integration enabled: ${registration.label}`);
  }
}
