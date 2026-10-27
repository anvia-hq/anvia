---
"@anvia/sandbox": patch
---

`anvia-sandbox-daemon --check` reports what an image offers (terminals, desktop) and which programs are missing, without connecting to a hub. `--require=desktop,terminal` makes it exit 1 when a feature is unavailable, so a Dockerfile can fail the build for an image that is missing a desktop program instead of finding out when the hub connects.
