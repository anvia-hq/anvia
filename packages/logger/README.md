# @anvia/logger

Structured logger adapters for Anvia.

Use this package when you want Anvia agent observer events to be written to a normal application logger. The package keeps logging outside `@anvia/core`: core emits lifecycle events, and `@anvia/logger` decides how those events become logs.

## Installation

```sh
pnpm add @anvia/logger @anvia/core
```

In this monorepo, the package is available through the workspace:

```sh
pnpm --filter @anvia/logger build
```

## Usage

```ts
import { Agent } from "@anvia/core";
import { OpenAIClient } from "@anvia/openai";
import { createLoggerObserver, createPinoLogger } from "@anvia/logger";

const logger = createPinoLogger({
  name: "support-app",
  level: "info",
});

const client = new OpenAIClient({
  apiKey,
});

const agent = new Agent({
  id: "support",
  model: client.completionModel({ modelId: "gpt-5", api: "responses" }),
  instructions: "Answer support questions clearly.",
  observability: {
    observers: {
      logger: createLoggerObserver({ logger }),
    },
  },
});

const result = await agent.generate({ prompt: "How do I reset my password?" });
if (result.type === "response") console.log(result.output);
```

The logger observer omits final outputs, full model requests, model responses, and tool results by
default. It records named Core observer events at their requested log level without copying their
free-form attributes. In particular,
`completion.retry` includes attempts, structured-output or provider-output classification, finish
reason, output lengths, per-attempt and cumulative usage, and whether rejected output was omitted
or represented by a bounded preview; it never logs that output or malformed tool arguments. Pass
`LoggerObserverOptions` to opt in when your data policy allows the other payloads in logs.

Agent errors are serialized before reaching the configured logger. Nested `Error.cause` chains keep
their `name`, `message`, and `stack`, including when the destination is Pino. Cause traversal is
bounded. Structured-output causes are reduced to safe type metadata because parser and schema error
messages can contain rejected model content; the outer error still records its phase, attempts,
lengths, usage, finish reasons, and detected format.

For local development without Pino output, use the console logger:

```ts
import { createConsoleLogger } from "@anvia/logger";

const logger = createConsoleLogger({
  name: "support-app",
  level: "debug",
});
```

### Writing to a file

Pass `filePath` to write newline-delimited JSON to a file:

```ts
import { createPinoLogger } from "@anvia/logger";

const logger = createPinoLogger({
  name: "support-app",
  level: "info",
  filePath: "logs/support-app.log",
});

logger.info("handled request", { requestId: "req_1" });
await logger.flush();
```

`filePath` creates missing parent directories (`mkdir`, default `true`), appends to an existing
file (`append`, default `true`), and writes each record synchronously (`sync`, default `true`) so
records are not lost on an abrupt `process.exit()`. Buffered writes are faster; set `sync: false`
and await `flush()` before shutting down:

```ts
const logger = createPinoLogger({ filePath: "logs/app.log", sync: false });

// ... log records ...

await logger.flush();
```

Every logger created by this package is a `FlushableLogger`, including child loggers: `flush()`
waits for writes that are already in flight, writes any remaining buffered records, and `fsync`s
file destinations. `createConsoleLogger` writes synchronously, so its `flush()` resolves
immediately.

Durability and failure modes depend on the destination:

- `filePath` is the only destination where `flush()` is a full guarantee. A file that cannot be
  opened throws from `createPinoLogger` when `sync` is `true` (the default), and rejects the
  `flush()` promise when `sync` is `false`. With `append: false` the file is truncated when the
  logger is created, not when the first record is written.
- A caller-supplied `destination` is flushed through its own `flushSync` or `flush` method when it
  has one, which covers Pino destinations. A plain writable such as `fs.createWriteStream` exposes
  no flush API, so `flush()` resolves without a durability guarantee; prefer `filePath` when records
  must survive an abrupt exit.
- `pinoOptions.transport` delegates to Pino's own `flush`. Pino's transport worker is unref'd, so
  call `flush()` during shutdown rather than in the same tick that the logger is created.

`filePath`, `destination`, and `pinoOptions.transport` are mutually exclusive, and `sync`, `mkdir`,
and `append` require `filePath`. Combining them throws, because Pino silently ignores a destination
stream when a transport is configured.

## Exports

- `createConsoleLogger`
- `createPinoLogger`
- `createLoggerObserver`
- `Logger`
- `FlushableLogger`
- `LoggerOptions`
- `LogContext`
- `LogLevel`
- `ConsoleLoggerOptions`
- `PinoLoggerOptions`
- `LoggerObserverOptions`

## Development

```sh
pnpm --filter @anvia/logger typecheck
pnpm --filter @anvia/logger test
pnpm --filter @anvia/logger build
```
