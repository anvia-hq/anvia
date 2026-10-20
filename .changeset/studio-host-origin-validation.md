---
"@anvia/studio": patch
---

Reject Studio HTTP requests whose Host header is not a loopback hostname or whose Origin header is not a loopback origin, blocking DNS rebinding and cross-origin page attacks on state-changing routes.
