---
"@anvia/server": patch
---

Evict closed in-memory resumable streams: remove closed streams after a configurable TTL and cap the number of retained closed streams (oldest first). Running streams are never evicted.
