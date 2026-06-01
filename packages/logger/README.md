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
import { AgentBuilder } from "@anvia/core";
import { OpenAIClient } from "@anvia/openai";
import { createLoggerObserver, createPinoLogger } from "@anvia/logger";

const logger = createPinoLogger({
  name: "support-app",
  level: "info",
});

const client = new OpenAIClient({
  apiKey,
});

const agent = new AgentBuilder("support", client.completionModel())
  .instructions("Answer support questions clearly.")
  .observe(createLoggerObserver(logger))
  .build();

const response = await agent.prompt("How do I reset my password?").send();

console.log(response.output);
```

The logger observer omits final outputs, full model requests, model responses, and tool results by default. Pass `LoggerObserverOptions` to opt in when your data policy allows those payloads in logs.

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
