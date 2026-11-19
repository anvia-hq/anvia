---
"@anvia/client": minor
---

`createDurableChatTransport`'s controller gains `status` (the run's last known durable status), `subscribe(listener)`, and `steer(input)`. `DurableChatClient` accepts an optional `steer`. A resumed run reads its current status once from the snapshot.
