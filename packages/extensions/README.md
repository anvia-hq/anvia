# `@anvia/extensions`

Batteries-included standard toolkits, guardrails, middlewares, and lifecycle hooks for Anvia agents — zero heavy vendor SDK dependencies, tree-shakeable via subpath exports, and safe by default.

## Installation

```sh
pnpm add @anvia/core @anvia/extensions zod
```

## Quickstart

```ts
import { Agent } from "@anvia/core";
import { OpenAIClient } from "@anvia/openai";
import { webSearch, tavily } from "@anvia/extensions/tools/web-search";
import { webFetch } from "@anvia/extensions/tools/web-fetch";
import { filesystem } from "@anvia/extensions/tools/fs";
import { shell } from "@anvia/extensions/tools/shell";
import { withToolSummary } from "@anvia/extensions/tools";
import { piiGuardrail, secretLeakGuardrail } from "@anvia/extensions/guardrails";
import { redactToolOutput, toolOutputLimit } from "@anvia/extensions/middlewares";
import { auditHook, usageHook } from "@anvia/extensions/hooks";

const openai = new OpenAIClient({ apiKey: process.env.OPENAI_API_KEY! });

const agent = new Agent({
  id: "research-coder",
  model: openai.completionModel({ modelId: "gpt-4.1" }),
  instructions: "You are a pragmatic research and coding assistant.",
  tools: [
    webSearch({ provider: tavily({ apiKey: process.env.TAVILY_API_KEY! }) }),
    webFetch({ allowedHosts: ["docs.anvia.dev"] }),
    filesystem({ rootDir: "./workspace" }),
    withToolSummary(shell({ rootDir: "./workspace" })),
  ],
  guardrails: [
    piiGuardrail({ boundary: "both", action: "redact" }),
    secretLeakGuardrail({ boundary: "output", action: "block" }),
  ],
  middlewares: [redactToolOutput(), toolOutputLimit({ maxChars: 16_000 })],
  lifecycle: [
    usageHook({ onReport: (report) => console.log(report) }),
    auditHook({ onEvent: (event) => console.log(event) }),
  ],
});
```

## Subpaths

### Tools (`@anvia/extensions/tools/*`)

Every toolkit accepts `@anvia/core`'s `ToolkitOptions` (`include`, `exclude`, `prefix`, `requiresApproval`, `timeoutMs`, `instructions`) and plugs directly into `Agent({ tools: [...] })`.

- `@anvia/extensions/tools/web-search` — `webSearch({ provider })` with pure-`fetch` adapters for `tavily`, `exa`, `brave`, `searxng`, `serper`, `perplexity`, `firecrawl`, and `jina` (plus custom `WebSearchProvider`).
- `@anvia/extensions/tools/web-fetch` — `webFetch()` with SSRF private-IP/redirect protection, HTML-to-text conversion, and byte/char limits.
- `@anvia/extensions/tools/fs` — `filesystem({ rootDir })` with `read_file`, `list_files`, `grep`, `write_file`, `edit_file`, `delete_file` (`delete_file` requires approval by default), `readOnly` mode, and `realpath` root containment.
- `@anvia/extensions/tools/shell` — `shell({ rootDir })` (`run_command`) for local workspace execution with `requiresApproval: true` by default, `execFile` (default, no shell interpolation) or `shell` mode, minimal sanitized `env`, `allowedCommands`/`deniedCommands`, timeout + process-group cleanup, and output caps. For untrusted code or prompts, use `@anvia/sandbox` instead.
- `@anvia/extensions/tools/git` — `git({ rootDir })` with read-only repo inspection (`git_status`, `git_diff`, `git_log`, `git_show`, `git_branch`) by default, plus opt-in `git_stage` and approval-gated `git_commit` when `readOnly: false`.
- `@anvia/extensions/tools/http` — `httpClient({ baseUrl | allowedHosts })` with fail-closed host allowlists, SSRF protection, and protected config-level auth headers.
- `@anvia/extensions/tools/todo` — `todo()` (`todo_read`, `todo_write`) for structured multi-step task tracking.
- `@anvia/extensions/tools/scratchpad` — `scratchpad()` (`note_get`, `note_set`, `note_delete`, `note_list`) backed by `InMemoryScratchpadStore` or a custom `ScratchpadStore`.
- `@anvia/extensions/tools/datetime` — `datetime()` (`current_time`, `convert_timezone`, `date_math`) with IANA timezone support.
- `@anvia/extensions/tools/math` — `math()` (`calculate`) with a safe recursive-descent parser (no `eval`).
- `@anvia/extensions/tools` — barrel export plus composable tool/toolkit wrappers:
  - `withToolCache(toolOrToolkit, { ttlMs, maxEntries })`
  - `withToolTimeout(toolOrToolkit, { timeoutMs })`
  - `withToolRetry(toolOrToolkit, { maxAttempts, backoffMs, retryOn })`
  - `withToolRateLimit(toolOrToolkit, { maxCalls, windowMs })`
  - `withToolSummary(toolOrToolkit, { field, description, required, onSummary })` — injects an LLM-generated human-readable label parameter into tool schemas for UIs/approval dialogs and strips it before invoking the inner tool.

### Guardrails (`@anvia/extensions/guardrails`)

- `piiGuardrail()` — detect, redact, or block PII (`email`, `creditCard`, `phone`, `ipv4`).
- `secretLeakGuardrail()` — block or redact leaked API keys, tokens, JWTs, and private keys.
- `patternGuardrail({ patterns })` — custom regex block or redact guardrail.
- `promptInjectionGuardrail()` — heuristic prompt-injection screening with optional second-stage `CompletionModel` judge.
- `topicGuardrail({ allowedTopics, blockedTopics, model? })` — keyword/regex or LLM-judged topic boundaries.
- `lengthGuardrail({ maxChars })` — block or truncate oversized inputs/outputs.
- `llmGuardrail({ model, policy })` — LLM-based policy classifier using any `CompletionModel`.

### Middlewares (`@anvia/extensions/middlewares`)

- `toolOutputLimit({ maxChars })` — cap oversized tool outputs (plain text or structured parts).
- `redactToolOutput()` — redact sensitive patterns from tool results before returning to the model.
- `redactCompletionRequest()` — redact outbound instructions, history, and documents.
- `sanitizeToolErrors()` — strip stack traces and absolute paths from tool error outputs sent back to the model.
- `historyWindow({ maxMessages?, maxChars? })` — trim older `chatHistory` turns while preserving leading system messages and keeping tool-call/tool-result groups intact.

### Lifecycle Hooks (`@anvia/extensions/hooks`)

- `usageHook({ onReport })` — per-run steps, tool calls, failures, duration, and token totals.
- `costHook({ pricing, onCost, budget?, onBudgetExceeded? })` (and `calculateUsageCost`) — token-aware run cost calculation (accounting for cached/cache-creation subsets of `inputTokens`) and optional budget alerts.
- `auditHook({ onEvent })` — normalized, timestamped audit records across lifecycle events.
- `jsonlHook({ filePath | write })` — append-only NDJSON lifecycle event logger with optional redaction.
- `consoleHook()` — readable developer lifecycle logger.
