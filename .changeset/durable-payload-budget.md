---
"@anvia/durable": patch
---

Document the effective payload budget per field, and stringify each field once per write.

- Docs: `durable-operations.md` gains a per-field budget table and says that status events are not
  payload-checked and duplicate the outcome. The stale "no startup warning" sentence is replaced
  with the current `createDurableHandler` warning.
- Limit checks serialize each persisted field once per write, not up to three times. Behaviour and
  error metadata are unchanged.
- Test: a single over-limit write names the field, the limit, and the actual size.
