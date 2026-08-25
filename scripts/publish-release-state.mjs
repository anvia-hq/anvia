export function releasesReadyForTags(
  alreadyPublished,
  newlyPublished,
  failed,
  recoverableTags = new Set(),
) {
  if (failed.length > 0) {
    return [];
  }

  const releases = new Map();
  for (const release of newlyPublished) {
    releases.set(`${release.name}@${release.version}`, release);
  }
  for (const release of alreadyPublished) {
    const tag = `${release.name}@${release.version}`;
    if (recoverableTags.has(tag)) {
      releases.set(tag, release);
    }
  }
  return [...releases.values()];
}
