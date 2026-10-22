import { randomUUID } from "node:crypto";
import type WebSocket from "ws";
import { z } from "zod";
import { DockerSandboxError } from "../errors";
import type { SandboxDesktop } from "./desktop";
import type { DesktopControl } from "./protocol";
import { sendJson } from "./relay-common";
import { RfbClientFilter } from "./rfb-filter";
import { bridgeTunnel } from "./tunnel-relay";

/** What a browser may do with a desktop, decided by `authorizeDesktop` for one upgrade request. */
export type DesktopAuthorization = Readonly<{
  sandboxId: string;
  /** Watch only: the viewer's keys, pointer and clipboard never reach the desktop. */
  readOnly?: boolean | undefined;
  /**
   * Who this viewer is when it takes control. Viewers with the same holder share a hold, so the
   * same person in two tabs is one holder. Default: a fresh id per connection.
   */
  holder?: string | undefined;
}>;

/** Subprotocol the hub selects for a desktop viewer. A client that only offers `binary` works too. */
export const desktopSubprotocol = "anvia.desktop.v1";
const binarySubprotocol = "binary";

export function selectDesktopProtocol(protocols: Set<string>): string | false {
  if (protocols.has(desktopSubprotocol)) return desktopSubprotocol;
  return protocols.has(binarySubprotocol) ? binarySubprotocol : false;
}

/** How long a viewer's hold lasts unless renewed, and how often it is renewed and re-read. */
const leaseMs = 30_000;
const renewMs = leaseMs / 3;
const pollMs = 1_500;

const textMessage = z.discriminatedUnion("type", [
  z.object({ type: z.literal("takeover") }),
  z.object({ type: z.literal("release") }),
]);

/**
 * Relay a browser's VNC viewer to the sandbox's desktop. Binary frames are the VNC stream, sent
 * through an RFB filter that holds back input from read-only viewers and from anyone who is not the
 * current holder. Text frames are a small JSON control channel: the browser asks to `takeover` or
 * `release`, and hears the control state as `{type:"control"}` whenever it changes.
 *
 * Taking over is what pauses the agent. A hold is a lease the relay keeps renewing while the
 * viewer is connected, and releases when it disconnects, so closing the tab hands control back.
 */
export function relayDesktop(
  ws: WebSocket,
  options: { desktop: SandboxDesktop; authorization: DesktopAuthorization },
): void {
  const { desktop, authorization } = options;
  const readOnly = authorization.readOnly === true;
  const holder = authorization.holder ?? `viewer-${randomUUID()}`;
  let control: DesktopControl = { held: false };
  let sent = "";
  let timers: Array<ReturnType<typeof setInterval>> = [];
  let stopped = false;

  const mayType = () => !readOnly && (!control.held || control.holder === holder);
  const filter = new RfbClientFilter(mayType);
  const youHold = () => control.held && control.holder === holder;

  const publish = (next: DesktopControl) => {
    control = next;
    const message = JSON.stringify({ type: "control", ...next, you: youHold(), readOnly });
    if (message === sent) return;
    sent = message;
    if (!stopped) sendJson(ws, JSON.parse(message));
  };
  const refresh = () => desktop.control().then(publish, () => undefined);
  const fail = (error: unknown) => {
    sendJson(ws, {
      type: "error",
      code: error instanceof DockerSandboxError ? error.code : "protocol",
      message: error instanceof Error ? error.message : "The request failed.",
    });
  };

  const opening = desktop.openViewer();
  void opening.then(
    () => {
      if (stopped) return;
      void refresh();
      timers = [
        setInterval(() => void refresh(), pollMs),
        setInterval(() => {
          if (youHold()) void desktop.takeover({ holder, leaseMs }).then(publish, () => undefined);
        }, renewMs),
      ];
      for (const timer of timers) timer.unref?.();
    },
    () => undefined,
  );

  bridgeTunnel(ws, opening, {
    filter: (bytes) => filter.push(bytes),
    onText: (text) => {
      const message = parseText(text);
      if (message === undefined) {
        ws.close(1003, "unknown control message");
        return;
      }
      if (readOnly) {
        fail(new DockerSandboxError("This viewer is read-only.", "tool_policy"));
      } else if (message.type === "takeover") {
        desktop.takeover({ holder, leaseMs }).then(publish, fail);
      } else {
        desktop.release({ holder }).then(publish, fail);
      }
    },
    onClose: () => {
      stopped = true;
      for (const timer of timers) clearInterval(timer);
      // A viewer that leaves must not keep the agent locked out.
      if (youHold()) void desktop.release({ holder }).catch(() => undefined);
    },
  });
}

function parseText(text: string) {
  try {
    const parsed = textMessage.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}
