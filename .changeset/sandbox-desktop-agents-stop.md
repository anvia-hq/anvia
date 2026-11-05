---
"@anvia/sandbox": patch
---

Stop the ssh-agent and gpg-agent that a desktop started when the desktop stops. These agents daemonize, so stopping the desktop's process group left them running. Only agents started with that desktop's environment are stopped; agents started elsewhere are left alone.
