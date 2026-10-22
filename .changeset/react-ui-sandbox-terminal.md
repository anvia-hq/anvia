---
"@anvia/react-ui": minor
---

Add `SandboxTerminal` at `@anvia/react-ui/sandbox-terminal`, an xterm.js terminal for the browser
relay of `RemoteSandboxHub`. It loads xterm on demand, refits with a `ResizeObserver`, shows its
connection state, reconnects with backoff (asking for a fresh single-use ticket each time), supports
read-only viewers, and cleans up on unmount. `@xterm/xterm` and `@xterm/addon-fit` are optional peer
dependencies, and the component is kept off the root export so apps that never render a terminal
never need them.
