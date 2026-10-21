---
"@anvia/acp": minor
---

Add session/cancel support with per-turn abort signals, cancellation error normalization, and invalidation of pending callbacks. Cancelled prompts settle once, discard late updates and preserve prior history; sessions remain busy while uncooperative execution finishes.
