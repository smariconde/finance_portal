export function expiredBackupManifests(
  manifests: readonly { name: string; createdAt: string }[],
  now: number,
): string[] {
  const cutoff = now - 30 * 24 * 60 * 60 * 1000;
  const dated = manifests
    .map((entry) => ({ ...entry, timestamp: Date.parse(entry.createdAt) }))
    .filter((entry) => Number.isFinite(entry.timestamp))
    .sort((a, b) => a.timestamp - b.timestamp);

  return dated
    .slice(0, -2)
    .filter((entry) => entry.timestamp < cutoff)
    .map((entry) => entry.name);
}
