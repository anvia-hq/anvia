# @anvia/acp guide

[Package overview and API reference](../../packages/acp/README.md)

Expose an application-owned Anvia agent to ACP editors. The adapter owns protocol framing,
session history, permissions and resource cleanup; the application owns models, credentials and
tool effects. It supports stable ACP v1, not the SDK's bundled experimental v2 schema.

## Installation and launcher

```sh
pnpm add @anvia/acp @anvia/core @anvia/openai
pnpm add -D @anvia/cli
pnpm exec anvia acp --agent ./agent.ts
# Or use the dedicated bin:
pnpm exec anvia-acp ./agent.ts
```

Start with the [export-only factory quickstart](../../packages/acp/README.md#quickstart).
The module can export a named/default factory or named/default Agent; an Agent instance supports
only one session. Factories run on creation/restore/config rebuild, not initialization. They must
return fresh ephemeral Agents without independently configured memory or structured output.

ESM JavaScript requires Node 20.18.1+. TypeScript uses native type stripping (Node 22.18+
recommended), explicit local extensions and erasable syntax; there is no `tsconfig` path alias,
JSX or enum transform. The launcher does not load environment files. Configure the provider in
the module/environment and keep credentials out of editor config committed to source control.

`anvia acp` and `anvia-acp` use the same process-owned launcher. It redirects application console
and stdout writes to stderr before import. Do not bypass it with fd 1 writes or inherited child
stdout. Embedded hosts use `serveStdio` or `createAcpConnection`; they own logging/signals and
must keep stdout protocol-only themselves.

## Editor configuration and cookbook

Copy the [Zed, JetBrains or CodeCompanion snippets](../../packages/acp/README.md#editor-setup).
The official formats are [Zed custom agents](https://zed.dev/docs/ai/external-agents#custom-agents),
[JetBrains ACP](https://www.jetbrains.com/help/ai-assistant/acp.html), and
[CodeCompanion custom ACP adapters](https://codecompanion.olimorris.dev/configuration/adapters-acp#creating-custom-acp-adapters).
They were checked on 2026-10-18; installed editor/plugin versions may differ. CodeCompanion's
current nested lifecycle/request handlers differ from the older ACP 10 smoke template.

The [Zed cookbook factory](../../cookbook/10_integrations/09-acp-zed-agent.ts) includes the exact
`agent_servers` config with absolute Node/CLI/module paths. From this repository's root:

```sh
pnpm --filter @anvia/cli... --filter @anvia/openai... build
pnpm cookbook:integrations:09
```

Use Node 22.18+ and set `OPENAI_API_KEY` in the root `.env` or process environment. Optional
`OPENAI_BASEURL` and `ANVIA_ACP_MODEL` customize the provider. The helper resolves `.env` relative
to its own file, loads it quietly at session creation, and preserves existing environment values.
Ask which workspace you are in to exercise the approval-gated `workspace_info` tool. The example
has no file/terminal backend or editor MCP launch policy. Running its module directly only defines
exports; running the launcher waits for ACP requests. Use the direct Node command from its header
in Zed, since package-manager script banners must not enter protocol stdout.

**Real editor runs are unverified.** ACP 10 still requires Zed plus an independent JetBrains or
Neovim run. Headless wire/TCK tests do not establish GUI compatibility, MCP forwarding, unsaved
buffer behavior, persistence UX or durable reattachment. Record actual results in
[EDITOR_COMPATIBILITY.md](../../packages/acp/test/EDITOR_COMPATIBILITY.md).

## Library host: tools, configuration and storage

Unlike launcher modules (which can export only `acpOptions.mcp` as host configuration), library
hosts can enable editor tools, model choices, slash commands, content policies and persistence.
For example, save this standalone executable as `host.ts` and launch it directly with Node:

```ts
import { FileAcpSessionStore } from "@anvia/acp";
import { serveStdio } from "@anvia/acp/stdio";
import { Agent } from "@anvia/core/agent";
import { OpenAIClient } from "@anvia/openai";

if (!process.env.OPENAI_API_KEY) throw new Error("Configure OPENAI_API_KEY before starting.");
const client = new OpenAIClient({ apiKey: process.env.OPENAI_API_KEY });
const modelId = process.env.ANVIA_ACP_MODEL ?? "gpt-5.5";
const connection = serveStdio({
  sessionStore: new FileAcpSessionStore("/absolute/private-app-data/acp-sessions.json"),
  workspaceRoots: ["/absolute/project"],
  editorTools: { readTextFile: true, writeTextFile: true, terminal: true },
  readOnlyMode: true,
  models: [{ value: modelId, name: "Project model" }],
  commands: [
    {
      name: "explain",
      description: "Explain code",
      expand: (args) => `Explain this code: ${args}`,
    },
  ],
  sessionFactory: (context) => ({
    agent: new Agent({
      id: context.sessionId,
      model: client.completionModel({ modelId: context.config.model ?? modelId, api: "responses" }),
      instructions: "Help with the project using only the supplied tools.",
      tools: context.editorTools,
      mcpServers: context.mcpServers,
      maxTurns: 4,
    }),
    // No additional application tools need read-only classification in this example.
    readOnlyTools: [],
    turnBudget: { maxModelCalls: 5, maxDurationMs: 5 * 60_000 },
  }),
});
const stop = () => void connection.close();
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
try {
  await connection.closed;
} finally {
  process.off("SIGINT", stop);
  process.off("SIGTERM", stop);
}
```

Replace the private store path and existing project directory. Enabling editor tools permits
privileged operations after client capability checks and once-only approval. No local backend is
substituted after denial or failure. `workspaceRoots` admits sessions; editor file paths/terminal
cwd are restricted to the session cwd unless `editorWorkspaceRoots` explicitly adds directories.
The editor must enforce access-time policy too. A contained terminal cwd does not sandbox commands.

The factory must attach the exact supplied editor tools/MCP registrations. ACP owns their cleanup;
`dispose()` should release only factory-owned handles. Application tools should resolve paths from
`context.cwd` and pass their abort signal through external calls. Never use `process.chdir()`.

Config changes cancel/wait/rebuild and preserve completed history. `read-only` omits editor writes,
terminals and editor MCP; every other registered tool needs explicit `readOnlyTools` classification.
Exclude opaque dynamic/provider/nested effects before exposing that mode. Existing approvals still
apply. Model catalog values are host identifiers, not credentials. Commands are pure synchronous
expansions of a sole `/name arguments` text block; unknown commands remain user text.

## Editor MCP launch policy

Client MCP is disabled by default in both launchers and library hosts. Export `acpOptions.mcp`
from the trusted agent module, or supply `mcp` to the library host. Stdio requires `stdio: true`
**and** `authorizeServer` returning exactly `true` for every declaration before any connection.
Use the [complete launcher allowlist example](../../packages/acp/README.md#mcp-passthrough).

Approve executable, every argument, environment and canonical cwd together. Server discovery can
execute a probe and a second process before tool permission UI exists. A client-selected name,
read-only annotation or `_meta` value grants no authority. Attach `context.mcpServers`; ACP supplies
stable prefixes, rejects collisions and enforces once-only approval on each tool invocation.

For an intentionally private Streamable HTTP endpoint, a host can use this typed policy:

```ts
import type { AcpMcpOptions } from "@anvia/acp";

export const mcp = {
  http: true,
  trustedHttpEndpoints: [{ url: "http://localhost:3000/mcp", addresses: ["127.0.0.1", "::1"] }],
  authorizeServer: (server, { cwd }) =>
    cwd === "/work/project" &&
    server.type === "http" &&
    server.url === "http://localhost:3000/mcp" &&
    Object.keys(server.headers).length === 0,
} satisfies AcpMcpOptions;
```

Pass this as `mcp` to `serveStdio`, or as `acpOptions = { mcp }` in a launcher module. Public HTTP
uses strict URL/DNS safety. Private exceptions are exact URLs with pinned IPs, never editor-owned
trust. Redirects fail; configured headers stay endpoint-scoped. Legacy SSE and ACP-proxied MCP are
unsupported. See [SECURITY.md](../../packages/acp/SECURITY.md) for privileged env values, egress,
launch authorization and remaining host responsibilities.

## Persistence and replay

The default in-memory store retains committed sessions, including after `session/close`, for its
own lifetime. Share a store across sequential connections or use `FileAcpSessionStore` for restart
persistence. The JSON snapshot adapter reads/rewrites the whole file and supports one owner only;
use a custom `AcpSessionStore` for larger stores, with atomic `put` and detached snapshots.
Optional `list`/`delete` methods gate their capabilities. It is distinct from core's `MemoryStore`.

| Operation | Contract                                                                                                                                      |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Load      | Rebuild current binding; replay only committed user/public/tool display entries before the response; replace the client's existing transcript |
| Resume    | Rebuild context without historical output                                                                                                     |
| List      | Metadata only, cwd/root filtering before 50-row keyset pagination; reuse cursor with the same filter                                          |
| Close     | Release capacity/resources while retaining records; cancel ephemeral work, detach durable work                                                |
| Delete    | Close then remove ACP records; absent deletion succeeds; durable pending work must settle/cancel first                                        |

Restore requires matching canonical cwd, available config and current workspace policy. The client
resupplies MCP declarations; stored credentials, grants and client capabilities are not restored.
Replay never generates output or executes old tools. Private model messages and the public display
transcript are separate: raw tool arguments/results, system prompts and all reasoning stay out of
replay. Explicit host display text/diffs remain public, including terminal command/argv/cwd metadata.

Successful ephemeral turns commit atomically. Interrupted approvals/generations are not checkpoints;
effects can have happened before a failed save. History overflow does not silently truncate.
Keep private records outside editor-controlled roots, protect backups and enforce exclusive ownership,
retention and quotas. The file store supplies 0600 files/0700 new directories, not encryption,
distributed locking or power-loss durability.

## Durable host

Install `@anvia/durable` separately and use Node 22.16+ for SQLite. This host uses static tools
(none in this minimal example), no connection-owned resources, and two coordinated private stores:

```sh
pnpm add @anvia/durable
```

```ts
import { FileAcpSessionStore } from "@anvia/acp";
import { createDurableSessionBinding } from "@anvia/acp/durable";
import { serveStdio } from "@anvia/acp/stdio";
import { Agent } from "@anvia/core/agent";
import { DurableRuntime } from "@anvia/durable";
import { SqliteDurableStore } from "@anvia/durable/sqlite";
import { OpenAIClient } from "@anvia/openai";

if (!process.env.OPENAI_API_KEY) throw new Error("Configure OPENAI_API_KEY before starting.");
const client = new OpenAIClient({ apiKey: process.env.OPENAI_API_KEY });
const agent = new Agent({
  id: "project-assistant",
  model: client.completionModel({ modelId: "gpt-5.5", api: "responses" }),
  instructions: "Explain the code supplied in chat.",
  maxTurns: 4,
});
const runtime = await DurableRuntime.open({
  store: new SqliteDurableStore("/absolute/private-app-data/runs.sqlite"),
});
try {
  const binding = createDurableSessionBinding(runtime, { agent, version: "assistant-v1" });
  await runtime.resume();
  const connection = serveStdio({
    sessionFactory: () => binding,
    sessionStore: new FileAcpSessionStore("/absolute/private-app-data/acp-sessions.json"),
  });
  const stop = () => void connection.close();
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  try {
    await connection.closed;
  } finally {
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
  }
} finally {
  await runtime.close();
}
```

Register once per runtime and reuse the binding. Durable's supported subset excludes memory,
lifecycle callbacks, middleware, guardrails, context sources, MCP servers, provider tools and tool
indexes. ACP additionally rejects editor tools (including reads), binding disposal, `turnBudget`
and config changes. Static tool resources must outlive connections; the host owns runtime shutdown.
Model-turn limits are persisted; ephemeral time/cost budgets do not apply.

Transport EOF/close and durable `session/close` **detach** the subscriber, leaving execution/waits
intact. In the process-owned example above, subsequent host shutdown closes the runtime and aborts
attempts while retaining checkpoints. In a long-lived host, disconnecting one subscriber must not
close the shared runtime. Keep the ACP store and runtime journal under the same exclusive owner
and backup policy; never replace just one store or submit unrelated work to ACP-owned session IDs.
Registration/driver identities are fenced; there is no automatic migration.

After load/resume, reattach to unfinished work using `session/prompt` with **`prompt: []`**.
Nonempty input gets `session_busy` while pending work exists; empty input otherwise is invalid.
Attachment does not grant approval and may redisplay uncommitted text with stable tool IDs.
Committed outcomes are projected, not live token deltas or partial retry attempts. Editor UX for
this explicit attachment convention is unverified.

`session/cancel` explicitly cancels pending durable work without undoing effects. Completed results
awaiting ACP commit stay recoverable; if bounds reject that output, raise limits and reattach.
Uncertain effects return `recovery_required`; a host operator inspects actual receipts and uses
`resolveTool` to reconcile them. Approval cannot reconcile an effect. Tool recovery defaults to
`manual`; use `safe` only for pure/repeatable work, and `idempotent` only with real service-side
deduplication of `operationId`. Deleting ACP history requires settled/cancelled work and does not
delete durable journals. See [the durable contract](../../packages/acp/DESIGN.md#acp-12-implementation-status).

## Bounds, errors and verification

`limits` overrides are positive safe integers. The public keys and defaults are:

| Keys                                                                  | Defaults                                                                 |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `maxSessions`, `maxConcurrentRequests`, `maxPendingRequests`          | 32 active/setup sessions, 64 inbound RPCs, 16 callbacks per session      |
| `maxPromptBytes`, `maxTextBytes`, `maxImageBytes`, `maxContentBlocks` | 10 MiB aggregate, 1 MiB text, 5 MiB decoded per image, 256 blocks        |
| `maxHistoryBytes`, `maxHistoryMessages`                               | 16 MiB each for private history/display transcript, 1,000 model messages |
| `maxTerminalOutputBytes`                                              | 1 MiB retained terminal output                                           |
| `maxReplayBatchEntries`, `maxReplayBatchBytes`                        | 10,000 entries / 16 MiB for a complete v1 load replay                    |

The separate `maxMessageBytes` defaults to 10 MiB including wire metadata. Oversized messages and
concurrent RPC overflow close the connection. History is never silently evicted; load replay is
validated before any entry is sent, with no partial replay/cursor. Limits do not bound arbitrary
provider/tool transient allocations, stored-record count or durable journal growth.

Errors expose safe `data.kind` values, not raw causes. Typical actions:

| Kind / result                      | Action                                                                    |
| ---------------------------------- | ------------------------------------------------------------------------- |
| `configuration_error`              | Check the trusted factory/provider setup and safe stderr diagnostics      |
| `policy_denied`, `unsupported_mcp` | Review the host allowlist/transport and editor forwarding                 |
| `session_busy`                     | Wait for execution/config cleanup, cancel, or attach pending durable work |
| `resource_limit`                   | Reduce input/history or deliberately raise the relevant host limit        |
| `unsupported_interaction`          | Use a client with form elicitation or avoid question tools                |
| `recovery_required`                | Host operator reconciles uncertain durable effects                        |
| `cancelled` stop reason            | Turn stopped; effects already started cannot be rolled back               |

Offline wire/subprocess tests and the recorded pinned upstream v1 TCK result are documented in
[CONFORMANCE.md](../../packages/acp/test/CONFORMANCE.md). GUI checks remain pending separately.
The SDK is pinned at `1.9.0` (stable schema `1.26.0`, wire integer `1`). v2 is disabled: its
acknowledgement/lifecycle, keyed upserts and cursor replay need a separate implementation and
validation. See [v2 gaps](../../packages/acp/DESIGN.md#v2-readiness-and-remaining-gaps).

```sh
pnpm check
pnpm --filter cookbook typecheck
pnpm --filter @anvia/acp typecheck
pnpm --filter @anvia/acp test:editors
pnpm releases:validate
```

Review [the security model](../../packages/acp/SECURITY.md) before adding local tools, editor
terminals, client MCP or persistent storage. This adapter supplies no OS sandbox or multi-user
network authentication layer.
