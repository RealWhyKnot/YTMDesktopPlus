import { app } from "electron";
import fs from "fs";
import path from "path";

export function migrateLegacyProfile(): boolean {
  if (process.env.YTMD_TEST_PROFILE) return false;

  const userData = app.getPath("userData");
  const legacyDir = path.join(path.dirname(userData), "YouTube Music Desktop App");
  if (fs.existsSync(path.join(userData, "config.json"))) return false;
  if (!fs.existsSync(path.join(legacyDir, "config.json"))) return false;

  fs.mkdirSync(userData, { recursive: true });

  for (const item of ["config.json", "Local State", "Partitions", ".first-run"]) {
    const source = path.join(legacyDir, item);
    try {
      if (fs.existsSync(source)) {
        fs.cpSync(source, path.join(userData, item), { recursive: true });
      }
    } catch (error) {
      console.warn("profile-migration: operation failed", error);
    }
  }
  return true;
}
