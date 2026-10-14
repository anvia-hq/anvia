export const RELEASE_PRESENTATIONS = {
  stable: {
    title: "Stable packages published",
    npmTag: "latest",
    color: 0x22c55e,
    description: "Stable packages",
  },
  preview: {
    title: "Preview packages published",
    npmTag: "preview",
    color: 0xf59e0b,
    description: "Preview packages",
  },
};

export function releasePresentation(channel) {
  const presentation = RELEASE_PRESENTATIONS[channel];
  if (presentation === undefined) {
    throw new Error("Release channel must be stable or preview.");
  }
  return presentation;
}
