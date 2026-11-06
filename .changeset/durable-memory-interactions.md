---
"@anvia/durable": minor
---

Allow a recorded memory run to pause for a human interaction. The paused segment's memory writes are flushed before the run waits. Core does not read memory on resume, so no message is offered twice. The resumed segment's writes use keys under the next epoch and are based on the version the previous segment left behind, so a writer that commits during the pause makes the resume `needs_attention` instead of overwriting it. Such a run used to fail with a `TypeError`.
