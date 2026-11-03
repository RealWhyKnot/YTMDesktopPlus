export type Integration = {
  provide(...args: unknown[]): void;
  enable(): void | Promise<void>;
  disable(): void | Promise<void>;
  getYTMScripts?(): { name: string; script: string }[];
};
