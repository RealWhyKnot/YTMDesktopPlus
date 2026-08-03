import { app } from "electron";
import fs from "fs";
import path from "path";

// One-time copy of the profile left behind by the app this project derives
// from, so existing settings and the YouTube Music sign-in survive the move to
// the new profile directory. Runs only when this app has no profile yet.
export function migrateLegacyProfile(): boolean {
  if (process.env.YTMD_TEST_PROFILE) return false;

  const userData = app.getPath("userData");
  const legacyDir = path.join(path.dirname(userData), "YouTube Music Desktop App");
  if (fs.existsSync(path.join(userData, "config.json"))) return false;
  if (!fs.existsSync(path.join(legacyDir, "config.json"))) return false;

  fs.mkdirSync(userData, { recursive: true });
  // Local State carries the cookie encryption key; Partitions carries the
  // YouTube Music session cookies it decrypts. Both stay readable because the
  // key is bound to the Windows user, not the application.
  for (const item of ["config.json", "Local State", "Partitions", ".first-run"]) {
    const source = path.join(legacyDir, item);
    try {
      if (fs.existsSync(source)) {
        fs.cpSync(source, path.join(userData, item), { recursive: true });
      }
    } catch {
      // A locked file (for example while the old app is running) skips that
      // item; everything else still migrates.
    }
  }
  return true;
}
