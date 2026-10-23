export interface DesktopResolution {
  width: number;
  height: number;
}

/** Programs the desktop needs, looked up on PATH unless given here. */
export interface DesktopBinaries {
  xvfb?: string;
  x11vnc?: string;
  xdotool?: string;
  xrandr?: string;
  /** ImageMagick's `import`, for screenshots. */
  import?: string;
}

export interface SandboxDaemonDesktopOptions {
  /** Size the display starts at. Default 1280x800. */
  resolution?: DesktopResolution;
  /** Largest size `resize` may ask for; Xvfb is started this big. Default 3840x2160. */
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
