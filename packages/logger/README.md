# @anvia/logger

Send Anvia agent lifecycle events to your application logs. Choose structured console output or
Pino, with child loggers, file destinations, and explicit flushing for shutdown.

## Install

```sh
pnpm add @anvia/logger @anvia/core @anvia/openai
```

The quickstart uses OpenAI as the model provider. Pino is included as a dependency.

## Quickstart

Set `OPENAI_API_KEY` in your server environment:

```ts
import { Agent } from "@anvia/core";
import { createLoggerObserver, createPinoLogger } from "@anvia/logger";
import { OpenAIClient } from "@anvia/openai";

const logger = createPinoLogger({ name: "support-app", level: "info" });
const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) throw new Error("Set OPENAI_API_KEY.");
const client = new OpenAIClient({ apiKey });
const agent = new Agent({
  id: "support",
  model: client.completionModel({ modelId: "gpt-5", api: "responses" }),
  instructions: "Answer support questions clearly.",
  observability: { observers: { logger: createLoggerObserver({ logger }) } },
});

try {
  const result = await agent.generate({ prompt: "How do I reset my password?" });
  if (result.type === "response") console.log(result.output);
} finally {
  await logger.flush();
}
```

The observer omits final outputs, full model requests and responses, and tool results by default.
Opt in to additional payloads only when they belong in your application's logs.

## Capabilities

- Console and Pino adapters with named, leveled, structured logs.
- Agent run, generation, tool, and retry events through `createLoggerObserver`.
- Child loggers that inherit context and support `flush()`.
- JSON file output with directory creation, append mode, and synchronous or buffered writes.
- Structured error serialization with bounded cause traversal.

Pass `filePath: "logs/app.log"` to `createPinoLogger` for file output. File writes are synchronous
by default; when using `sync: false`, await `flush()` before shutdown. Flush guarantees depend on
the destination, as described in the guide.

## Learn more

- [Logger options and file durability](https://github.com/anvia-hq/anvia/blob/main/docs/packages/logger.md)
- [Core observability and agents](https://github.com/anvia-hq/anvia/blob/main/docs/packages/core.md)
