# @anvia/mistral

Mistral provider adapter for Anvia.

```ts
import { AgentBuilder } from "@anvia/core";
import { MistralClient } from "@anvia/mistral";

const client = new MistralClient({ apiKey: process.env.MISTRAL_API_KEY });
const model = client.completionModel("mistral-large-latest");

const agent = new AgentBuilder("support", model)
  .instructions("Answer clearly and concisely.")
  .build();

const response = await agent.prompt("What should I check before launch?").send();
console.log(response.output);
```

## Embeddings

```ts
const embeddings = client.embeddingModel("mistral-embed");
const vectors = await embeddings.embedTexts(["Refunds take five business days."]);
```

## Capabilities

The v1 adapter supports text completions, streaming, tools, tool choice, structured output, and Mistral embeddings. Image inputs, document file inputs, transcription, audio generation, image generation, and model listing are not implemented yet.
