import { detectFeatures } from "./daemon/features";
import { LocalSandbox } from "./daemon/local-sandbox";
import type { SandboxDaemonOptions } from "./daemon/daemon";
import { desktopCapability, terminalCapability } from "./remote/protocol";

export const checkableFeatures = ["terminal", "desktop"] as const;
export type CheckableFeature = (typeof checkableFeatures)[number];

export interface DaemonCheck {
  /** What the daemon would advertise to a hub in `hello`. */
  capabilities: string[];
  /** Why each feature is on or off, in the words the daemon logs at startup. */
  notes: string[];
  /** The required features that are not available. */
  missing: CheckableFeature[];
}

const capabilityOf: Record<CheckableFeature, string> = {
  terminal: terminalCapability,
  desktop: desktopCapability,
};

/**
 * Look for what this image offers the way the daemon does at its first connection, without
 * connecting. `required` names the features that must be there, for a build step or a health check.
 */
export async function checkDaemon(
  options: Pick<SandboxDaemonOptions, "terminal" | "tunnel" | "desktop">,
  workdir: string,
  required: readonly CheckableFeature[] = [],
): Promise<DaemonCheck> {
  const notes: string[] = [];
  const features = await detectFeatures(options, new LocalSandbox({ workdir }), (_level, message) =>
    notes.push(message),
  );
  if (options.desktop === false) notes.push("desktop turned off");
  if (options.terminal === false) notes.push("terminals turned off");
  const missing = required.filter((name) => !features.capabilities.includes(capabilityOf[name]));
  return { capabilities: features.capabilities, notes, missing };
}

/** The feature names after `--require`, as `--require=desktop,terminal` or `--require desktop`. */
export function requiredFeatures(argv: readonly string[]): CheckableFeature[] {
  const names: string[] = [];
  argv.forEach((arg, index) => {
    if (arg === "--require") names.push(...(argv[index + 1] ?? "").split(","));
    else if (arg.startsWith("--require=")) names.push(...arg.slice("--require=".length).split(","));
  });
  const unique = [...new Set(names.map((name) => name.trim()).filter((name) => name !== ""))];
  for (const name of unique) {
    if (!(checkableFeatures as readonly string[]).includes(name)) {
      throw new Error(`--require expects ${checkableFeatures.join(" or ")}, not "${name}".`);
    }
  }
  return unique as CheckableFeature[];
}
