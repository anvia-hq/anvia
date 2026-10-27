import { describe, expect, it } from "vitest";
import * as daemon from "../src/daemon/index";
import * as remote from "../src/remote/index";

describe("subpath exports", () => {
  it("exposes the hub, runtime, terminal, tunnel and desktop from /remote", () => {
    expect(Object.keys(remote).sort()).toEqual([
      "PROTOCOL_VERSION",
      "RemoteSandboxDesktop",
      "RemoteSandboxHub",
      "RemoteSandboxRuntime",
      "RemoteSandboxTerminal",
      "RemoteSandboxTunnel",
      "desktopSubprotocol",
      "originAllowed",
      "relayTicket",
      "studioDesktopView",
      "studioSandbox",
      "terminalSubprotocol",
      "terminalTicket",
      "tunnelSubprotocol",
    ]);
  });

  it("exposes the daemon from /daemon", () => {
    expect(Object.keys(daemon)).toEqual(["SandboxDaemon"]);
  });
});
