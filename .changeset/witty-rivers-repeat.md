---
"@anvia/server": patch
---

Reject reopening a running resumable stream instead of silently discarding its history. Reopening a closed stream id still resets it to a fresh running stream.
