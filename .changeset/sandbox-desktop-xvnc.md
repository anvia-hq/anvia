---
"@anvia/sandbox": minor
---

The desktop now runs on TigerVNC's `Xvnc` when it is installed: the display and the VNC server in one
process, told about changes instead of polling for them as x11vnc does, which gives a viewer lower
latency and smoother updates (and keeps a continuously changing screen from starving the VNC
server). Images that only have `Xvfb` and `x11vnc` keep working: the daemon falls back to that pair.
`desktop: { backend: "auto" | "xvnc" | "xvfb" }` and `desktop.binaries.{ xvnc, vncconfig }` choose or
locate them, and naming `xvfb` or `x11vnc` in `binaries` keeps the pair. On Xvnc the display starts
at the configured size and grows up to `maxResolution`, a viewer cannot resize it, and the daemon
runs `vncconfig -nowin` (when installed) so the clipboard syncs. The reference image installs
`tigervnc-standalone-server` instead of `xvfb x11vnc`.
