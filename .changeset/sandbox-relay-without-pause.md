---
"@anvia/sandbox": patch
---

Fix the hub's browser tunnel and desktop relays crashing the process on runtimes whose WebSocket
cannot pause, such as Bun. The relay called `ws.pause()` and `ws.resume()`, which Bun's own
WebSocket (substituted for the `ws` package) does not have, so the first message from a browser
threw `TypeError: ws.resume is not a function` inside a promise callback and exited the process.
The relay now asks once whether the socket can pause. Where it cannot, it closes a browser that has
more than 4 MiB waiting to reach the service with code 1008 and an explicit reason, instead of
buffering without end. Sockets that can pause behave as before. The other relays (terminals, the
daemon link, pings and upgrades) were checked on Bun and need no change, and the Bun compatibility
suite now runs a hub, daemon and browser relay on Bun.
