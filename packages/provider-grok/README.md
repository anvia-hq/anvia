# @anvia/grok

Bring xAI models, live search, and server-executed tools to Anvia agents. Combine
Grok tools with your own application tools in one agent.

## Install

```sh
pnpm add @anvia/grok @anvia/core
```

## Quickstart

Set `XAI_API_KEY` before running this example.

```ts
import { Agent } from "@anvia/core";
import { GrokClient } from "@anvia/grok";

const client = new GrokClient({
  apiKey: process.env.XAI_API_KEY!,
});
const agent = new Agent({
  id: "assistant",
  model: client.completionModel({ modelId: "grok-4.6", api: "responses" }),
  instructions: "Answer clearly and concisely.",
});

const result = await agent.generate({
  prompt: "What should I check before launching a new product?",
});

if (result.type === "response") {
  console.log(result.output);
}
```

## What you can build

- Chat Completions and Responses APIs with streaming.
- Responses tools for web search, X search, code execution, collections, and remote MCP.
- Typed reasoning controls, image generation, batch speech, and transcription.
- Model listing and custom transport configuration.

Select `api: "responses"` to use provider tools. Pass them through the Agent constructor
`tools` option alongside local tools. Chat Completions is the default API.

## Learn more

- [Usage guide](https://github.com/anvia-hq/anvia/blob/main/docs/packages/provider-grok.md)
- [Anvia overview](https://github.com/anvia-hq/anvia/blob/main/README.md)
- [Contributing](https://github.com/anvia-hq/anvia/blob/main/CONTRIBUTING.md)
