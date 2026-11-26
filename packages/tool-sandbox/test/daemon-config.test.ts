import { describe, expect, it } from "vitest";
import {
  desktopOptionsFromEnv,
  parseDaemonCliArgs,
  tunnelOptionsFromEnv,
} from "../src/daemon-config";

describe("desktopOptionsFromEnv", () => {
  it("leaves the daemon's defaults alone when nothing is set", () => {
    expect(desktopOptionsFromEnv({})).toBeUndefined();
    expect(desktopOptionsFromEnv({ ANVIA_SANDBOX_DESKTOP_RESOLUTION: "  " })).toBeUndefined();
  });

  it("turns the desktop off with ANVIA_SANDBOX_DESKTOP=0", () => {
    expect(
      desktopOptionsFromEnv({
        ANVIA_SANDBOX_DESKTOP: "0",
        ANVIA_SANDBOX_DESKTOP_RESOLUTION: "800x600",
      }),
    ).toBe(false);
  });

  it("reads each option", () => {
    expect(
      desktopOptionsFromEnv({
        ANVIA_SANDBOX_DESKTOP_BACKEND: "xvfb",
        ANVIA_SANDBOX_DESKTOP_RESOLUTION: "1440x900",
        ANVIA_SANDBOX_DESKTOP_MAX_RESOLUTION: "1920x1080",
        ANVIA_SANDBOX_DESKTOP_DISPLAY: ":42",
        ANVIA_SANDBOX_DESKTOP_VNC_PORT: "5901",
        ANVIA_SANDBOX_DESKTOP_WINDOW_MANAGER: "openbox --config-file /etc/rc.xml",
      }),
    ).toEqual({
      backend: "xvfb",
      resolution: { width: 1440, height: 900 },
      maxResolution: { width: 1920, height: 1080 },
      display: ":42",
      vncPort: 5901,
      windowManager: "openbox --config-file /etc/rc.xml",
    });
  });

  it('runs without a window manager for "none"', () => {
    expect(desktopOptionsFromEnv({ ANVIA_SANDBOX_DESKTOP_WINDOW_MANAGER: "none" })).toEqual({
      windowManager: false,
    });
  });

  it.each([
    ["ANVIA_SANDBOX_DESKTOP_BACKEND", "x11"],
    ["ANVIA_SANDBOX_DESKTOP_RESOLUTION", "big"],
    ["ANVIA_SANDBOX_DESKTOP_RESOLUTION", "0x900"],
    ["ANVIA_SANDBOX_DESKTOP_MAX_RESOLUTION", "1920"],
    ["ANVIA_SANDBOX_DESKTOP_DISPLAY", "99"],
    ["ANVIA_SANDBOX_DESKTOP_VNC_PORT", "70000"],
    ["ANVIA_SANDBOX_DESKTOP_VNC_PORT", "abc"],
  ])("rejects %s=%s", (name, raw) => {
    expect(() => desktopOptionsFromEnv({ [name]: raw })).toThrow(name);
  });
});

describe("tunnelOptionsFromEnv", () => {
  it("leaves defaults alone when nothing is set", () => {
    expect(tunnelOptionsFromEnv({})).toBeUndefined();
    expect(tunnelOptionsFromEnv({ ANVIA_SANDBOX_TUNNEL_ALLOWED_PORTS: "  " })).toBeUndefined();
  });

  it("turns tunnels off with ANVIA_SANDBOX_TUNNEL=0", () => {
    expect(
      tunnelOptionsFromEnv({
        ANVIA_SANDBOX_TUNNEL: "0",
        ANVIA_SANDBOX_TUNNEL_ALLOWED_PORTS: "3000",
      }),
    ).toBe(false);
  });

  it("parses and deduplicates allowed ports", () => {
    expect(
      tunnelOptionsFromEnv({ ANVIA_SANDBOX_TUNNEL_ALLOWED_PORTS: "3000, 5900, 3000" }),
    ).toEqual({ allowedPorts: [3000, 5900] });
  });

  it.each(["0", "70000", "abc", ","])("rejects malformed port list %s", (raw) => {
    expect(() => tunnelOptionsFromEnv({ ANVIA_SANDBOX_TUNNEL_ALLOWED_PORTS: raw })).toThrow(
      "ANVIA_SANDBOX_TUNNEL_ALLOWED_PORTS",
    );
  });
});

describe("parseDaemonCliArgs", () => {
  it("parses valid options", () => {
    expect(parseDaemonCliArgs([])).toEqual({
      help: false,
      version: false,
      check: false,
      require: [],
    });
    expect(parseDaemonCliArgs(["--version"])).toMatchObject({ version: true });
    expect(parseDaemonCliArgs(["--check", "--require=desktop,terminal"])).toEqual({
      help: false,
      version: false,
      check: true,
      require: ["desktop", "terminal"],
    });
    expect(parseDaemonCliArgs(["--check", "--require", "desktop"])).toMatchObject({
      check: true,
      require: ["desktop"],
    });
  });

  it("rejects unknown options and --require without --check", () => {
    expect(() => parseDaemonCliArgs(["--check", "--requier=desktop"])).toThrow("Unknown option");
    expect(() => parseDaemonCliArgs(["--require=desktop"])).toThrow("--check");
    expect(() => parseDaemonCliArgs(["--check", "--require=unknown"])).toThrow(
      /terminal or desktop/,
    );
  });
});
