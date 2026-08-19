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
if (result.status === "completed") console.log(result.output);
```

The logger observer omits final outputs, full model requests, model responses, and tool results by
default. It records named Core observer events at their requested log level without copying their
free-form attributes. In particular,
`completion.retry` includes attempts, failure phase, finish reason, output lengths, per-attempt and
cumulative usage, and whether rejected output was omitted or represented by a bounded preview; it
never logs that output. Pass `LoggerObserverOptions` to opt in when your data policy allows the
other payloads in logs.

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

## Exports

- `createConsoleLogger`
- `createPinoLogger`
- `createLoggerObserver`
- `Logger`
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
