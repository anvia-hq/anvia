---
"@anvia/durable": minor
"@anvia/server": patch
---

Accept per-field payload budgets in `maxPayloadBytes`.

- `@anvia/durable`: `maxPayloadBytes` takes either a number (one budget for every field, as before)
  or an object with `prompt`, `operation`, `event`, and `outcome` budgets. Each omitted group falls
  back to `default`, which defaults to 1,048,576 bytes. `runtime.limits()` returns the resolved
  object. Payload errors keep their fields (`code`, `field`, `limit`, `actual`), and `limit` is the
  effective budget for that field. Unknown keys and non-positive values are rejected at open.
- `@anvia/server`: the startup body-limit warning compares `maxBodyBytes` with the largest per-field
  budget, so it reads the new shape. The warning text for a number is unchanged.
- Docs: `durable-operations.md` has the field-to-budget table and notes that a prompt is also
  copied into the history and outcome.
