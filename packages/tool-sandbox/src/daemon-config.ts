import type { DesktopResolution, SandboxDaemonDesktopOptions } from "./daemon/desktop/options";

type Env = Readonly<Record<string, string | undefined>>;

const backends = ["auto", "xvnc", "xvfb"] as const;

/**
 * The desktop options the daemon CLI reads from the environment. Returns `false` when the desktop
 * is switched off and `undefined` when nothing is set, which leaves the daemon's defaults alone.
 */
export function desktopOptionsFromEnv(env: Env): false | SandboxDaemonDesktopOptions | undefined {
  if (value(env, "ANVIA_SANDBOX_DESKTOP") === "0") return false;

  const options: SandboxDaemonDesktopOptions = {};
  const backend = value(env, "ANVIA_SANDBOX_DESKTOP_BACKEND");
  if (backend !== undefined) {
    if (!(backends as readonly string[]).includes(backend)) {
      throw new Error(`ANVIA_SANDBOX_DESKTOP_BACKEND must be one of ${backends.join(", ")}.`);
    }
    options.backend = backend as (typeof backends)[number];
  }
  const resolution = resolutionOf(env, "ANVIA_SANDBOX_DESKTOP_RESOLUTION");
  if (resolution !== undefined) options.resolution = resolution;
  const maxResolution = resolutionOf(env, "ANVIA_SANDBOX_DESKTOP_MAX_RESOLUTION");
  if (maxResolution !== undefined) options.maxResolution = maxResolution;
  const display = value(env, "ANVIA_SANDBOX_DESKTOP_DISPLAY");
  if (display !== undefined) {
    if (!/^:\d+$/.test(display)) {
      throw new Error("ANVIA_SANDBOX_DESKTOP_DISPLAY must look like :99.");
    }
    options.display = display;
  }
  const vncPort = value(env, "ANVIA_SANDBOX_DESKTOP_VNC_PORT");
  if (vncPort !== undefined) {
    const port = Number(vncPort);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error("ANVIA_SANDBOX_DESKTOP_VNC_PORT must be a port number.");
    }
    options.vncPort = port;
  }
  const windowManager = value(env, "ANVIA_SANDBOX_DESKTOP_WINDOW_MANAGER");
  if (windowManager !== undefined) {
    options.windowManager = windowManager === "none" ? false : windowManager;
  }
  return Object.keys(options).length === 0 ? undefined : options;
}

function value(env: Env, name: string): string | undefined {
  const raw = env[name]?.trim();
  return raw === undefined || raw === "" ? undefined : raw;
}

function resolutionOf(env: Env, name: string): DesktopResolution | undefined {
  const raw = value(env, name);
  if (raw === undefined) return undefined;
  const match = /^(\d+)x(\d+)$/.exec(raw);
  const width = Number(match?.[1]);
  const height = Number(match?.[2]);
  if (match === null || width < 1 || height < 1) {
    throw new Error(`${name} must look like 1440x900.`);
  }
  return { width, height };
}
