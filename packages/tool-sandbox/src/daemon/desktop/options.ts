export interface DesktopResolution {
  width: number;
  height: number;
}

/** Programs the desktop needs, looked up on PATH unless given here. */
export interface DesktopBinaries {
  /** TigerVNC's X server, which is the display and the VNC server in one process. */
  xvnc?: string;
  /**
   * TigerVNC's `vncconfig`, which Xvnc needs running to sync the clipboard with desktop programs.
   * Optional: without it everything but the clipboard works.
   */
  vncconfig?: string;
  /** With `x11vnc`: the older pair, used when there is no `Xvnc`. */
  xvfb?: string;
  x11vnc?: string;
  xdotool?: string;
  xrandr?: string;
  /** ImageMagick's `import`, for screenshots. */
  import?: string;
}

/** How the display and its VNC server run: one `Xvnc` process, or `Xvfb` with `x11vnc`. */
export type DesktopBackend = "xvnc" | "xvfb";

export interface SandboxDaemonDesktopOptions {
  /**
   * `auto` (the default) uses `Xvnc` when it is installed, and `Xvfb` with `x11vnc` otherwise, so
   * images built for the older pair keep working. Naming `xvnc` or `xvfb`/`x11vnc` in `binaries`
   * also picks that backend.
   */
  backend?: "auto" | DesktopBackend;
  /** Size the display starts at. Default 1280x800. */
  resolution?: DesktopResolution;
  /**
   * Largest size `resize` may ask for. Default 3840x2160. The Xvfb backend starts this big and
   * shrinks; Xvnc starts at `resolution` and grows.
   */
  maxResolution?: DesktopResolution;
  /** X display. Default `:99`. */
  display?: string;
  /** Loopback port for the VNC server. Default 5900. */
  vncPort?: number;
  /** Window manager command, or false to run without one. Default `openbox-session` (openbox, plus its autostart file), or `openbox`, if installed. */
  windowManager?: string | false;
  binaries?: DesktopBinaries;
  /** How long to wait for the display and VNC server after starting them. Default 15 s. */
  startTimeoutMs?: number;
  /** Restarting a crashed process: backoff, and how many quick failures in a row to give up after. */
  restart?: { initialDelayMs?: number; maxDelayMs?: number; maxFailures?: number };
  lock?: {
    /** How long a takeover lasts unless renewed. Default 60 s. */
    leaseMs?: number;
    /** Longest lease a holder may ask for. Default 1 hour. */
    maxLeaseMs?: number;
    /**
     * Wait this long for a human to release before an agent input fails with `desktop_locked`.
     * Default 0: fail at once.
     */
    waitForReleaseMs?: number;
  };
}
