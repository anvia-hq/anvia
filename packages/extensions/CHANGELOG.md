# @anvia/extensions

## 0.3.0

### Minor Changes

- 56366b9: Expand `@anvia/extensions` with `shell`, `git`, `datetime`, `scratchpad`, and `math` toolkits, `serper`/`perplexity`/`firecrawl`/`jina` web-search providers, `withToolTimeout`/`withToolRetry`/`withToolRateLimit`/`withToolSummary` wrappers, `patternGuardrail`/`promptInjectionGuardrail`/`topicGuardrail` guardrails, `sanitizeToolErrors`/`historyWindow` middlewares, and `costHook`/`jsonlHook` lifecycle hooks.

## 0.2.0

### Minor Changes

- 60f6709: Add `Toolkit` support (`createToolkit`, `isToolkit`) to `Agent.tools` and `createToolIndex`, add array composition support to `Agent.lifecycle`, and introduce the `@anvia/extensions` package with standard toolkits (`web-search`, `web-fetch`, `fs`, `http`, `todo`), `withToolCache`, guardrails, middlewares, and lifecycle hooks.
