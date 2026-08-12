import path from "node:path";
import { execSync } from "node:child_process";
import type { UserConfig } from "vite";

export const sharedAlias = {
  "~shared": path.resolve(__dirname, "../src/shared")
};

export function gitInfo(): { branch: string; commitHash: string } {
  try {
    return {
      branch: execSync("git rev-parse --abbrev-ref HEAD").toString(),
      commitHash: execSync("git rev-parse HEAD").toString()
    };
  } catch (e) {
    // User has likely downloaded from the YTM Desktop via the "Download ZIP".
    // We don't plan to support this, but at least provide users with a bit of improved UX
    // by providing them with what to do rather than just leaving them in the dust.
    e.message =
      " ======= Failed to get Git Info. ======= \n" +
      "Please make sure that when building this application you are cloning the repository from GitHub rather than using the Download ZIP option.\n" +
      "Follow the instructions in the README.md file to clone the repository and build the application from there.\n" +
      " ======= Failed to get Git Info. ======= \n\n" +
      e.message;
    // Re-throw the error so that the build fails with the updated message.
    throw e;
  }
}

export function preloadConfig(windowDir: string, extra: UserConfig = {}): UserConfig {
  return {
    resolve: { alias: sharedAlias },
    build: { outDir: `.vite/renderer/windows/${windowDir}` },
    ...extra
  };
}
