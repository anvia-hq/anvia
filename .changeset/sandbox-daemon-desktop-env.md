---
"@anvia/sandbox": patch
---

`anvia-sandbox-daemon` now reads the desktop's settings from the environment: `ANVIA_SANDBOX_DESKTOP=0` turns it off, and `ANVIA_SANDBOX_DESKTOP_BACKEND`, `_RESOLUTION`, `_MAX_RESOLUTION`, `_DISPLAY`, `_VNC_PORT` and `_WINDOW_MANAGER` configure it. Before, changing any of them meant writing your own `SandboxDaemon` entrypoint.
