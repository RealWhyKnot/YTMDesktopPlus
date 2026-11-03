export function filterLogTailForAddon(logText: string, id: string): string[] {
  const marker = `(addon:${id})`;
  return logText.split(/\r?\n/).filter((line) => line.includes(marker));
}
