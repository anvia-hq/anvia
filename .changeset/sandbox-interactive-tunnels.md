---
"@anvia/sandbox": minor
---

Tunnels can ask for the `interactive` flow profile, `hub.tunnel(id).open(port, { profile:
"interactive" })`, for streams a person is watching, like a desktop's VNC. The terminal-sized
defaults (10 ms batching, 16 KiB frames, a 256 KiB window) allow about 2.6 MB/s over a 100 ms link;
the profile sends frames at once, 64 KiB at a time, with a 2 MiB window and a 4 MiB socket buffer,
and sizes the hub's buffer, write window (1 MiB) and ack step (128 KiB) to match. `desktop.openViewer()`
and the browser desktop relay use it. The profile is an optional string in `tunnel.open`, which a daemon that
applied it echoes in `tunnel.opened`, so there is no protocol bump: a daemon without it uses its
defaults and the hub does too until it is confirmed. `SandboxDaemon`'s
`tunnel: { flowByPort }` sets limits for one port and wins over the profile.
