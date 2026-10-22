---
"@anvia/sandbox": minor
---

Add port tunnels to remote sandboxes. `hub.tunnel(sandboxId).open(port)` returns a duplex handle
(`write`, an ordered `output` iterable, `close`, and an `exit` promise) that carries raw TCP to a
service on the sandbox's own loopback. Only `127.0.0.1` and `::1` are reachable, enforced by the
hub, the frame schema and the daemon, and `SandboxDaemon` accepts `tunnel: { allowedPorts,
maxTunnels }` or `tunnel: false`. Tunnels are negotiated through the `tunnel` capability, so mixed
versions fail with `unsupported`.

Flow control is shared with terminals (one stream channel on the daemon, one inbound stream on the
hub) and runs in both directions, so a slow or stalled reader cannot grow memory and tunnel traffic
cannot delay `exec` calls, terminals or heartbeats.

`RemoteSandboxHub` also gains `handleTunnelUpgrade`, `authorizeTunnel`, `maxTunnelBufferBytes` and a
`tunnelPath` listen option for a browser relay with the same ticket and Origin rules as the terminal
relay. The shared helpers are exported as `relayTicket` and `originAllowed`; `terminalTicket` remains
as an alias. An invalid `pty.open` or `tunnel.open` frame now fails the caller immediately instead of
leaving it waiting.
