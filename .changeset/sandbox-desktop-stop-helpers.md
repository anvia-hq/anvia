---
"@anvia/sandbox": patch
---

Stop a desktop's helper processes when the desktop stops or restarts.

The window manager's autostart starts helpers such as dbus, at-spi, gvfs and ssh-agent. Stopping
the desktop only signalled its own process, so these helpers kept running after every stop or
restart. Each desktop now runs in its own process group, and stopping it signals the whole group.
