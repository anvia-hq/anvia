# @anvia/mistral

Mistral completion and embedding provider adapter for Anvia.

Use this package when you want Anvia agents, extractors, pipelines, embeddings, or model listing to run on Mistral APIs.

## Installation

```sh
pnpm add @anvia/mistral @anvia/core
```

In this monorepo, the package is available through the workspace:

```sh
pnpm --filter @anvia/mistral build
```

## Usage

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

## OCR

```ts
const ocr = client.ocrModel();
const result = await ocr.ocr({
  source: {
    type: "document_url",
    url: "https://example.com/invoice.pdf",
    documentName: "invoice.pdf",
  },
});

console.log(result.markdown);
```

## Model Listing

```ts
const models = await client.listModels();
```

## Capabilities

The v1 adapter supports text completions, streaming, tools, tool choice, structured output, Mistral embeddings, OCR, and model listing. Chat image inputs, chat document file inputs, transcription, audio generation, and image generation are not implemented yet.

## Exports

- `MistralClient`
- `MistralCompletionModel`
- `MistralEmbeddingModel`
- `MistralOcrModel`
- `MistralClientOptions`
- `MistralEmbeddingModelOptions`
- `MistralOcrRequest`
- `MistralOcrResponse`
- `MISTRAL_OCR_LATEST`
- `mistralMessageHelpers`
- `mistral`

## Development

```sh
pnpm --filter @anvia/mistral typecheck
pnpm --filter @anvia/mistral test
pnpm --filter @anvia/mistral build
```

Package-local `typecheck` and `build` scripts build `@anvia/core` first so core subpath types are available in a fresh worktree.
