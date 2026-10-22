import { describe, expect, it } from "vitest";
import * as daemon from "../src/daemon/index";
import * as remote from "../src/remote/index";

describe("subpath exports", () => {
  it("exposes the hub, runtime and terminal from /remote", () => {
    expect(Object.keys(remote).sort()).toEqual([
      "PROTOCOL_VERSION",
      "RemoteSandboxHub",
      "RemoteSandboxRuntime",
      "RemoteSandboxTerminal",
      "originAllowed",
      "terminalSubprotocol",
      "terminalTicket",
    ]);
  });

  it("exposes the daemon from /daemon", () => {
    expect(Object.keys(daemon)).toEqual(["SandboxDaemon"]);
  });
});
