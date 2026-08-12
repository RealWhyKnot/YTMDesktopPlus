/** Lines a scoped addon logger wrote, as they appear in the log file. The
 *  format stamps scopes as " (addon:<id>)" between the level and the text. */
export function filterLogTailForAddon(logText: string, id: string): string[] {
  const marker = `(addon:${id})`;
  return logText.split(/\r?\n/).filter(line => line.includes(marker));
}
