---
"@anvia/react-ui": minor
---

Add `SandboxDesktop` at `@anvia/react-ui/sandbox-desktop`, a noVNC viewer for the desktop relay of
`RemoteSandboxHub`. It scales the desktop to fit, shows its connection state, reconnects with
backoff and a fresh single-use ticket, and lets a person take control from the agent and release it,
with read-only viewers supported and a viewer that cannot type while someone else holds control.
noVNC is loaded on demand. `@novnc/novnc` is an optional peer dependency, and the component stays
off the root export so apps that never render a desktop never need it.

The terminal and desktop viewers now share one relay connection (reconnect with backoff, a fresh
ticket per attempt, status line); the terminal's behavior is unchanged.
