export function releasesReadyForTags(alreadyPublished, newlyPublished, failed) {
  if (failed.length > 0) {
    return [];
  }

  const releases = new Map();
  for (const release of [...alreadyPublished, ...newlyPublished]) {
    releases.set(`${release.name}@${release.version}`, release);
  }
  return [...releases.values()];
}
