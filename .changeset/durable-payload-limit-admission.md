---
"@anvia/durable": minor
"@anvia/server": patch
"@anvia/client": minor
---

Make payload-limit admission honest and stop losing session history.

- A run that cannot start because its prompt, input, or inherited history exceeds
  `maxPayloadBytes` now ends in terminal `failed` instead of parking in
  `needs_attention`. `run.result()` rejects with `DurableRunError` (`status: "failed"`) and
  the event stream ends, so no supervisor action or stuck SSE subscription is left behind.
- `retry()` of a run whose admission rolled back recomputes the inherited history from the
  session's latest settled run and persists it before execution. If the history still does
  not fit, `retry()` rejects with the same `DurableLimitError` and the run stays failed; a
  retry never executes with a shorter history (previously it ran with only the prompt and
  silently truncated the session).
- `DurableLimitError` gains `code` (`"payload_too_large" | "capacity_exceeded"`), `field`,
  `limit`, and `actual`. Messages name the offending field and byte counts, for example
  `Durable payload byte limit exceeded: run.input is 2048 bytes; limit is 2000 bytes.`
- `createDurableHandler` maps payload limits to HTTP 413 and capacity to 429, returning
  `{ error, code, field? }`. The body-too-large 413 also reports the `maxBodyBytes` limit.
- `DurableHttpError` in `@anvia/client` now exposes `status`, `code`, `field`, and the
  server's error message instead of discarding the response body.
- Docs state which limit applies to what, that the HTTP body limit is the binding ceiling for
  uploads, and that an over-limit admission is a terminal failure.
- `@anvia/server` and `@anvia/client` widen their optional `@anvia/durable` peer range to
  `^0.13.0` so the new minor line stays resolvable.
