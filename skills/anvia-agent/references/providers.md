# Providers

Provider behavior lives in provider packages, never in `@anvia/core`:

- `@anvia/openai`, `@anvia/anthropic`, `@anvia/gemini`, `@anvia/mistral`,
  `@anvia/grok` — check the owning package README for client names and model options.
- Typical shape: `new OpenAIClient({ baseUrl, apiKey })`, then
  `client.completionModel({ modelId, api: "responses" })` for the Agent model.
- Embedding, transcription, and image/audio generation follow the same split:
  core contracts, provider adapters in `packages/provider-*`, local embeddings
  in `packages/embedding-transformers`.

## Rules

- Never import a vendor SDK in `@anvia/core` (or in app code that claims to be
  provider-agnostic) — add a provider adapter instead.
- Read credentials from the environment at the boundary
  (`process.env.OPENAI_API_KEY ?? ""`); never commit keys or trace payloads.
- Tests must mock or fake provider SDKs. Ordinary package tests must not need
  network access or real API keys.
- Match the package's import style: some packages use extensionless local
  imports, many adapters use `.js` suffixes in source imports.
