---
"@anvia/sandbox": minor
---

Tunnel bytes, such as a desktop's VNC stream, now travel between the daemon and the hub as binary
WebSocket messages instead of base64 inside JSON, once both sides list the new `binary-data`
capability in `hello` and `welcome`. A peer without it keeps using `tunnel.data` with base64, so
mixed versions work and `PROTOCOL_VERSION` does not change. Acknowledgements, open and close, and all
other frames stay JSON, terminal output is unchanged, and the browser relays forward the same bytes
through the same RFB filter. `binaryData: false` on `RemoteSandboxHub` or `SandboxDaemon` switches it
off for a proxy that mishandles binary messages.
