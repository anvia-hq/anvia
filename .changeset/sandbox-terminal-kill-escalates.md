---
"@anvia/sandbox": patch
---

Kill a terminal session that ignores SIGHUP. The daemon now sends SIGKILL to a shell that is still running one second after SIGHUP, so `kill` ends the session instead of leaving it waiting for input.
