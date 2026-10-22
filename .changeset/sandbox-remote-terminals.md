---
"@anvia/sandbox": minor
---

Add interactive terminals to remote sandboxes. `hub.terminal(sandboxId)` returns a
`SandboxTerminal` with `open`, `list` and `kill`; `open` gives a typed handle with `write`,
`resize`, `close`, an ordered `output` iterable and an `exit` promise. The daemon runs each session
in tmux (3.2+), where it persists across hub disconnects and daemon restarts, or falls back to a
plain shell with a bounded scrollback ring. PTYs come from `node-pty`, an optional peer dependency
the daemon image installs, so Docker-only users install no native code.

Terminals are negotiated through an additive `capabilities` list in `hello` and `welcome` rather
than a protocol bump, so mixed hub and daemon versions fail with the new `unsupported` error code
instead of a protocol error. Output is batched, numbered and acknowledged per terminal, so a flood
cannot delay `exec` calls or heartbeats and a stalled viewer cannot grow memory.

`RemoteSandboxHub` also gains `handleTerminalUpgrade`, `authorizeTerminal`, `allowedOrigins` and
`terminalTicket` for a browser relay that checks a short-lived ticket and the request Origin and
enforces read-only viewers.
