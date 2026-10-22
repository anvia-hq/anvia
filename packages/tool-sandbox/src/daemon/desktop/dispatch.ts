import { DockerSandboxError } from "../../errors";
import type { RequestFrame } from "../../remote/protocol";
import type { DesktopService } from "./service";

export type DesktopRequestFrame = Extract<RequestFrame, { method: `desktop${string}` }>;

/** Answer a desktop request, or the typed error a daemon without a desktop gives. */
export async function dispatchDesktop(
  desktop: DesktopService | undefined,
  frame: DesktopRequestFrame,
  signal: AbortSignal,
): Promise<unknown> {
  if (desktop === undefined) {
    throw new DockerSandboxError("This sandbox has no desktop support.", "unsupported");
  }
  switch (frame.method) {
    case "desktopStatus":
      return desktop.status(frame.params.start === true);
    case "desktopResize":
      return desktop.resize(frame.params.width, frame.params.height);
    case "desktopScreenshot":
      return desktop.screenshot(frame.params.scale, signal);
    case "desktopCursor":
      return desktop.cursor(signal);
    case "desktopAction":
      await desktop.act(frame.params.action, signal);
      return {};
    case "desktopControl":
      return desktop.controlState();
    case "desktopTakeover":
      return desktop.takeover(frame.params.holder, frame.params.leaseMs);
    case "desktopRelease":
      return desktop.release(frame.params.holder, frame.params.force);
  }
}
