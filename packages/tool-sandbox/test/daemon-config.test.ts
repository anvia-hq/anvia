import { describe, expect, it } from "vitest";
import { desktopOptionsFromEnv } from "../src/daemon-config";

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
