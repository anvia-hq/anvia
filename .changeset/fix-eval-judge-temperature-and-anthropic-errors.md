---
"@anvia/core": patch
"@anvia/anthropic": patch
---

Fix eval judge temperature defaults, Anthropic temperature capability handling, extractor error diagnostics and 4xx retry behavior, and TypeScript 7 tuple mapping for `defineEvalSuite`:

- Omit `temperature` by default in `runJudge()` (and add opt-in `temperature` to LLM judge metrics) so models that reject `temperature` work out of the box.
- Add optional `temperature` capability validation to `CompletionModelCapabilities` and declare `temperature: false` on `AnthropicCompletionModel`, omitting `temperature` from Anthropic Messages request serialization.
- Include the underlying cause message in `ExtractionError` and `EvalOutcome.fromError()`, skip retrying non-retryable 4xx HTTP errors in `extract()`, and classify provider API errors as `kind: "provider"`.
- Keep `EvalCasesForMetrics` and `DefinedEvalSuite` tuple mapping homomorphic under both TypeScript 5.9 and TypeScript 7.
