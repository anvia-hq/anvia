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

- `@anvia/extensions/tools/web-search` — `webSearch({ provider })` with `tavily`, `exa`, `brave`, and `searxng` adapters.
- `@anvia/extensions/tools/web-fetch` — `webFetch()` with SSRF private-IP/redirect protection, HTML-to-text conversion, and byte/char limits.
- `@anvia/extensions/tools/fs` — `filesystem({ rootDir })` with `read_file`, `list_files`, `grep`, `write_file`, `edit_file`, `delete_file` (`delete_file` requires approval by default), `readOnly` mode, and `realpath` root containment.
- `@anvia/extensions/tools/http` — `httpClient({ baseUrl | allowedHosts })` with fail-closed host allowlists, SSRF protection, and protected config-level auth headers.
- `@anvia/extensions/tools/todo` — `todo()` (`todo_read`, `todo_write`) for structured multi-step task tracking.
- `@anvia/extensions/tools` — barrel export plus `withToolCache(toolOrToolkit, { ttlMs, maxEntries })`.

### Guardrails (`@anvia/extensions/guardrails`)

- `piiGuardrail()` — detect, redact, or block PII (`email`, `creditCard`, `phone`, `ipv4`).
- `secretLeakGuardrail()` — block or redact leaked API keys, tokens, JWTs, and private keys.
- `lengthGuardrail({ maxChars })` — block or truncate oversized inputs/outputs.
- `llmGuardrail({ model, policy })` — LLM-based policy classifier using any `CompletionModel`.

### Middlewares (`@anvia/extensions/middlewares`)

- `toolOutputLimit({ maxChars })` — cap oversized tool outputs (plain text or structured parts).
- `redactToolOutput()` — redact sensitive patterns from tool results before returning to the model.
- `redactCompletionRequest()` — redact outbound instructions, history, and documents.

### Lifecycle Hooks (`@anvia/extensions/hooks`)

- `usageHook({ onReport })` — per-run steps, tool calls, failures, duration, and token totals.
- `auditHook({ onEvent })` — normalized, timestamped audit records across lifecycle events.
- `consoleHook()` — readable developer lifecycle logger.
