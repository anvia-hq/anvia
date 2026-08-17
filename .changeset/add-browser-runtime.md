---
"@anvia/browser": patch
"@anvia/sandbox": patch
"@anvia/studio": patch
---

Add the explicit Docker-backed Chromium browser runtime, semantic browser tools, noVNC desktop,
Studio's clean resizable Playground viewer, and a human-control lease. Add the shared-memory and seccomp
options required to keep Chromium's process sandbox enabled, including explicit capability additions
for its namespace sandbox.
