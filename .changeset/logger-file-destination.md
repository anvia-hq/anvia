---
"@anvia/logger": patch
---

Add first-class file logging and flushing to `@anvia/logger`.

- `createPinoLogger` accepts `filePath` to write newline-delimited JSON to a file, along with
  `sync`, `mkdir`, and `append` options. `sync` and `mkdir` default to `true` so records survive an
  abrupt `process.exit()` and missing parent directories are created.
- `Logger` gains an optional `flush()` method, and `createPinoLogger` / `createConsoleLogger` return
  a new `FlushableLogger` type where `flush()` is always callable, including on child loggers.
- Combining output targets now throws instead of silently dropping log output. Configuring
  `destination` together with `pinoOptions.transport` previously discarded the destination stream
  without warning; it now throws, as do `filePath` with either of them and `sync` / `mkdir` /
  `append` without `filePath`.
