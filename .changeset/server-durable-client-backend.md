---
"@anvia/server": minor
---

`createDurableHandler` accepts a store-only `DurableClient` from `@anvia/durable` as `runtime`, so the HTTP API can run in a process that holds no agents while `DurableWorker`s execute the runs. Runs and graphs are served with the same authorization; custom task routes answer 501 for such a backend. The option type is now the structural `DurableHandlerBackend`.
