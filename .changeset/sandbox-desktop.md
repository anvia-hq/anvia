---
"@anvia/sandbox": minor
---

Add a desktop capability to remote sandboxes. `hub.desktop(sandboxId)` returns a `SandboxDesktop`
with `screenshot` (optionally scaled), `act` (move, click, drag, scroll, type, key), `cursorPosition`,
`resize`, `status`, and a control lock: `takeover` pauses the agent's inputs with a typed
`desktop_locked` error until `release` or the lease runs out, while watching and screenshots are
never blocked.

The daemon runs an X server with a VNC server (loopback only, no password) and a window manager itself: lazily on
first use, restarting what crashes, and advertising `desktop` only when the programs are installed.
The window manager defaults to `openbox-session` (openbox, which also runs `~/.config/openbox/autostart`), else `openbox`. A reference Debian image with a themed desktop and dock, Chromium and tmux is in `images/desktop/`. Viewers reach VNC through
a tunnel; `hub.handleDesktopUpgrade` and `authorizeDesktop` relay a browser's noVNC connection,
filtering the RFB stream so read-only viewers, and viewers who are not the current holder, cannot
send input, and offering a JSON control channel for taking over and releasing.

`SandboxDaemon` gains `desktop: false | { resolution, maxResolution, display, vncPort, windowManager,
lock, ... }`. The new `desktop_locked` error code is added.
