# @anvia/acp

Run your Anvia agent in an editor through the [Agent Client Protocol](https://agentclientprotocol.com/).
This agent-side adapter supplies ACP v1 sessions, streaming, permissions and optional persistence.
Your application supplies the model, credentials, instructions and tools.

## Install

```sh
pnpm add @anvia/acp @anvia/core @anvia/openai
pnpm add -D @anvia/cli
```

Requires Node.js 22.19.0+ (including the MCP transport's Undici dependency). For `.ts`/`.mts`
modules, enable native type stripping. Use erasable types, `import type` and explicit local import extensions;
Node does not resolve `tsconfig` aliases or transform JSX, enums or parameter properties. On older
Node versions, compile to JavaScript or supply your own loader. The CLI does not install a
transpiler or load `.env` files. Choose any Anvia provider in place of OpenAI.

For `tsc --noEmit` checks of native `.ts` imports, enable `allowImportingTsExtensions`.

## Quickstart

Save as `agent.ts` in an ESM project and supply `OPENAI_API_KEY` in the launch environment:

```ts
import type { AcpSessionFactory } from "@anvia/acp";
import { Agent } from "@anvia/core/agent";
import { OpenAIClient } from "@anvia/openai";

export const sessionFactory: AcpSessionFactory = (context) => {
  if (!process.env.OPENAI_API_KEY) throw new Error("Configure OPENAI_API_KEY before starting.");
  const client = new OpenAIClient({ apiKey: process.env.OPENAI_API_KEY });
  return {
    agent: new Agent({
      id: context.sessionId,
      model: client.completionModel({ modelId: "gpt-5.5", api: "responses" }),
      instructions: "Help explain code and propose changes. Use only the supplied tools.",
      tools: context.editorTools,
      mcpServers: context.mcpServers,
      maxTurns: 4,
    }),
  };
};
```

### Launcher

```sh
pnpm exec anvia acp --agent ./agent.ts
# Equivalent dedicated bin, without @anvia/cli:
pnpm exec anvia-acp ./agent.ts
```

These start a protocol server and wait for an editor's requests. Paths resolve against the launch
directory. Export a named `sessionFactory`, a default factory, or a named/default `Agent` instance.
Precedence is named factory, default export, named `agent`. An exported Agent is single-use: a
second session is rejected. Prefer a factory for multiple chats, restore and config changes.

The launcher reserves stdout for JSON-RPC before module import, redirecting `console` and
`process.stdout.write` to stderr. Avoid direct fd 1 writes and inherited child stdout. Startup
errors are sanitized; EOF, SIGINT and SIGTERM await cleanup with a five-second deadline. Export
definitions without calling `generate` or starting servers on import. Put session-owned cleanup
in the binding's `dispose()`.

The [cookbook example](https://github.com/anvia-hq/anvia/blob/main/cookbook/10_integrations/09-acp-zed-agent.ts) quietly loads a
repository-root `.env` and exports a factory without starting execution on import.

## Editor setup

Replace every `/absolute/project` path and make a suitable Node version and provider environment
available to the editor subprocess. Config shapes were checked against the linked official docs
on 2026-10-18 and the [repository editor notes](https://github.com/anvia-hq/anvia/blob/main/packages/acp/test/EDITOR_COMPATIBILITY.md).
**ACP 10 manual editor acceptance is still pending.** Disable MCP forwarding until you configure
[host MCP policy](#mcp-passthrough).

### Zed

Merge into settings, then select **Anvia** for a new External Agent thread. This follows Zed's
[custom agent format](https://zed.dev/docs/ai/external-agents#custom-agents):

```json
{
  "agent_servers": {
    "Anvia": {
      "type": "custom",
      "command": "/absolute/project/node_modules/.bin/anvia",
      "args": ["acp", "--agent", "/absolute/project/agent.ts"],
      "env": {}
    }
  }
}
```

Use `dev: open acp logs` for diagnostics. The cookbook header includes a complete config with
an explicit Node executable and environment-file handling.

### JetBrains AI Assistant

Choose **Add Custom Agent** in AI Chat and merge into `~/.jetbrains/acp.json`. The
[JetBrains format](https://www.jetbrains.com/help/ai-assistant/acp.html) uses no Zed `type` key:

```json
{
  "default_mcp_settings": { "use_custom_mcp": false, "use_idea_mcp": false },
  "agent_servers": {
    "Anvia": {
      "command": "/absolute/project/node_modules/.bin/anvia",
      "args": ["acp", "--agent", "/absolute/project/agent.ts"],
      "env": {}
    }
  }
}
```

Select **Anvia** in AI Chat; use **Get ACP Logs** for diagnostics. Credentials belong to your
module; this adapter advertises no ACP login method.

### Neovim / CodeCompanion

Install CodeCompanion, then merge this adapter into its setup. It follows the current
[custom ACP adapter format](https://codecompanion.olimorris.dev/configuration/adapters-acp#creating-custom-acp-adapters).
Older revisions and the ACP 10 smoke template use different handlers; follow the docs for your
installed revision. This configuration has not been executed in Neovim.

```lua
require("codecompanion").setup({
  adapters = {
    acp = {
      anvia = function()
        local helpers = require("codecompanion.adapters.acp.helpers")
        return {
          name = "anvia",
          formatted_name = "Anvia",
          type = "acp",
          roles = { llm = "assistant", user = "user" },
          commands = {
            default = {
              "/absolute/project/node_modules/.bin/anvia",
              "acp", "--agent", "/absolute/project/agent.ts",
            },
          },
          defaults = { mcpServers = {}, timeout = 20000 },
          parameters = { protocolVersion = 1, clientCapabilities = {} },
          handlers = {
            lifecycle = {
              setup = function() return true end,
              auth = function() return true end,
            },
            request = { build_messages = helpers.build_messages },
          },
        }
      end,
    },
  },
})
```

Open `:CodeCompanionChat adapter=anvia`. The auth handler reflects ACP's no-op authentication;
it does not configure or validate provider credentials.

## API reference

### Connections and exports

| Import                | API                                                                                                                       |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `@anvia/acp`          | `createAcpConnection(options: AcpConnectionOptions): AcpConnection` for caller-owned Web byte streams (`input`, `output`) |
| `@anvia/acp/stdio`    | `serveStdio(options: AcpStdioOptions): AcpConnection`; optional Node streams default to stdin/stdout                      |
| `@anvia/acp/launcher` | `runStdioServer(modulePath: string): Promise<void>` and type `AcpLauncherOptions`                                         |
| `@anvia/acp/durable`  | `createDurableSessionBinding(runtime, registration): AcpSessionBinding`; optional `@anvia/durable` peer                   |
| `@anvia/acp`          | `InMemoryAcpSessionStore`, `FileAcpSessionStore`, `mapSandboxPath(path, { sandboxRoot, hostRoot })`                       |

`AcpConnection` exposes `closed: Promise<void>` and idempotent `close(): Promise<void>`.
Library hosts own stderr logging, signals and shutdown; imports have no process side effects.
Library close waits for cooperative execution/disposal and leaves the caller's output stream open.
Calling `runStdioServer` owns logging, signals and process exit. Launcher configuration reads
**only** `acpOptions.mcp`; other host settings require a library host.

### Session factory

`AcpSessionFactory` is `(context: AcpSessionContext) => AcpSessionBinding | Promise<AcpSessionBinding>`.
It runs after workspace/MCP validation on new sessions, load/resume and config rebuilds, never
during initialization. For ephemeral execution, return a fresh text-output Agent with no `memory`
or `outputSchema`; ACP owns bounded conversation history.

| Context field               | Meaning                                                                                 |
| --------------------------- | --------------------------------------------------------------------------------------- |
| `sessionId`, `cwd`          | Opaque session ID and canonical, existing absolute workspace directory                  |
| `clientCapabilities`        | `readTextFile`, `writeTextFile`, `terminal`, `elicitationForm` booleans                 |
| `policy`                    | Immutable `permissionPreset`, effective editor `workspaceRoots` and `editorTools` flags |
| `config`                    | `AcpSessionConfig`: `mode: "ask"                                                        | "read-only"`, optional host model identifier `model` |
| `mcpServers`, `editorTools` | Approved Anvia registrations; attach the supplied objects unchanged                     |
| `signal`                    | Session lifetime signal; prompts receive a separate linked abort signal                 |

`AcpSessionBinding` requires `agent`; optional fields are `dispose`, `turnBudget`, `readOnlyTools`,
`toolPresentation`, and a `driver` created by the durable helper. Resolve tool paths against
`context.cwd`; never change process cwd. Dispose only binding-owned resources; ACP owns supplied
MCP clients/editor wrappers.

`AcpTurnBudget` supports `maxModelCalls`, `maxDurationMs`, `maxCost` and `estimateCost(usage)`.
Budgets span all continuation segments and permission waits. Model calls are capped by
`agent.defaultMaxTurns + 1`, optionally lowered by `maxModelCalls`. Time/cost have no default
ceiling; cost is a host estimate checked after generation, not a guarantee against charges.

`toolPresentation(call)` returns `AcpToolPresentation`: public `title`, `text`, `kind`,
`locations: [{ path, line? }]` and `diffs: [{ path, oldText?, newText }]`. Lines are one-based;
omit unknown `oldText`, use `null` for a known new file. Raw arguments/results stay private.
`mapSandboxPath` maps corresponding sandbox/host paths for display; it does not mount/synchronize
files. See [presentation/backend details](https://github.com/anvia-hq/anvia/blob/main/packages/acp/DESIGN.md#acp-08-implementation-status).

### Host options

`AcpOptions` requires `sessionFactory`; `AcpConnectionOptions` also requires Web streams.
`AcpStdioOptions` adds optional Node streams. Other settings are optional:

The root also exports `AcpAgentInfo`, `AcpClientCapabilities`, `AcpSessionPolicy` and `AcpLimits`
for the corresponding options and context snapshots.

| Option                                   | Default / behavior                                                                                           |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `sessionStore`                           | New isolated `InMemoryAcpSessionStore`                                                                       |
| `agentInfo`                              | Package identity; override with `{ name, version, title? }`                                                  |
| `maxMessageBytes`                        | 10 MiB per incoming NDJSON message; overflow closes transport                                                |
| `images`, `embeddedContext`, `reasoning` | `false`; images require compatible models; reasoning is live plaintext only                                  |
| `mcp`                                    | Client MCP disabled; see below                                                                               |
| `editorTools`                            | All off; `readTextFile`, `writeTextFile`, `terminal` intersect with client capabilities                      |
| `workspaceRoots`                         | No admission allowlist; validates each cwd. Roots do not widen editor tool access                            |
| `editorWorkspaceRoots`                   | No extra editor roots beyond cwd; explicit existing absolute directories                                     |
| `readOnlyMode`                           | `false`; adds the `read-only` config choice when enabled                                                     |
| `models`                                 | No catalog; `{ value, name }[]`, first entry is default; factory selects via `context.config.model`          |
| `commands`                               | Empty; `AcpCommand`: `{ name, description, inputHint?, expand(args, context) }`, pure synchronous expansions |
| `limits`                                 | Positive safe integer overrides; defaults below                                                              |

Config changes cancel active work, wait for cleanup and rebuild while preserving committed history.
A read-only factory must classify every remaining application tool in `readOnlyTools` and exclude
opaque effects; editor writes/terminals/MCP are omitted. Legacy `session/set_mode` is unsupported.
Commands expand only a sole matching text block; unknown commands remain text. See the
[host configuration guide](https://github.com/anvia-hq/anvia/blob/main/docs/packages/acp.md).

### Permissions and cancellation

Application tools retain `requiresApproval`. Editor tools (including reads) and editor MCP tools
always request **allow once** or **reject once**. Malformed/failed replies deny; cancellation stops
the turn. Grants never persist. Question tools use form `elicitation/create` only with client form
support; otherwise the prompt fails with `unsupported_interaction`. No answers are read from stdin.

`session/cancel` aborts generation/tools, invalidates callbacks and settles the original prompt
once with `cancelled`. Cancelled ephemeral turns do not commit history. Tools must honor abort;
uncooperative execution keeps the session busy until it finishes. Cancellation cannot undo effects.
Editor terminal cleanup after disconnect is best effort.

## MCP passthrough

Editors supply declarations during session setup. ACP connects them before calling your factory;
attach `context.mcpServers` to the Agent. Tools have stable server prefixes and approval wrappers.
Denied setup fails rather than silently dropping servers.

Since ACP 14, stdio requires **both** `stdio: true` and `authorizeServer` returning exactly `true`
for each server before any process starts. A trusted launcher module can export this beside its
factory; library hosts pass the same policy as `mcp`:

```ts
import type { AcpLauncherOptions } from "@anvia/acp/launcher";

export const acpOptions = {
  mcp: {
    stdio: true,
    authorizeServer: (server, { cwd }) =>
      cwd === "/work/project" &&
      server.type === "stdio" &&
      server.command === "/usr/local/bin/editor-mcp" &&
      server.args.length === 0 &&
      Object.keys(server.env).length === 0,
  },
} satisfies AcpLauncherOptions;
```

Approve the complete executable/argv/env/cwd tuple, not a client-chosen name. Startup/discovery
execute code **before** tool approval; negotiation may start a probe and a session process.
Client metadata cannot supply policy. Tool calls still require once-only approval.

`AcpMcpOptions` also exposes `http`, `trustedHttpEndpoints: [{ url, addresses }]` and optional
HTTP restrictions via `authorizeServer`. HTTP is off by default; opt-in uses Streamable HTTP with
strict URL/DNS safety. Private access requires an exact host-approved endpoint and pinned IPs;
endpoint redirects fail. `AcpMcpServer` supplied to authorization has normalized env/header records.
Legacy SSE and ACP-proxied MCP are unsupported. Review [SECURITY.md](https://github.com/anvia-hq/anvia/blob/main/packages/acp/SECURITY.md) before opting in.

## Persistence and session lifecycle

Use a library host for persistence. Save as a separate executable `host.ts` alongside `agent.ts`
and launch directly with Node (not `--agent`):

```ts
import { FileAcpSessionStore } from "@anvia/acp";
import { serveStdio } from "@anvia/acp/stdio";
import { sessionFactory } from "./agent.ts";

const connection = serveStdio({
  sessionFactory,
  sessionStore: new FileAcpSessionStore("/absolute/private-app-data/acp-sessions.json"),
});
await connection.closed;
```

This source import uses native type stripping; for compiled JavaScript use `./agent.js`. Keep logs
on stderr and own shutdown. The file store atomically replaces JSON snapshots (0600 files, 0700
new directories). Keep storage outside editor-controlled roots, with one active connection/owner.
It supplies no distributed locks, encryption, retention, quotas or power-loss guarantee.

| RPC              | Behavior                                                                                                                       |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `session/load`   | Rebuilds and replays committed original user content, public text and tool presentation; client replaces its displayed history |
| `session/resume` | Rebuilds with the same context, silently, without replay                                                                       |
| `session/list`   | Metadata only; cwd/root filters before pagination, 50 rows/page; return `nextCursor` as `cursor` with the same filter          |
| `session/close`  | Releases resources, retains records; ephemeral work is cancelled                                                               |
| `session/delete` | Closes and removes ACP history; repeated/absent deletes succeed                                                                |

Load/resume require matching canonical cwd and current config/workspace policy. Clients resupply
MCP declarations; saved credentials, capabilities or approvals are never reused. Replay never
executes historical tools. Only successful ephemeral turns commit; history is not an execution
checkpoint. Replay excludes reasoning, raw tool arguments/results and system prompts.

Custom `AcpSessionStore` implementations provide `get(id)` and atomic whole-record `put(record)`;
optional `list(query)` and `delete(id)` gate those capabilities. Return detached snapshots;
missing records (`undefined`) differ from empty history. Root types include `AcpSessionStore`,
`AcpSessionRecord`, `AcpSessionInfo`, `AcpSessionPage`, `AcpSessionQuery` and `AcpTranscriptEntry`.
See [storage/replay details](https://github.com/anvia-hq/anvia/blob/main/packages/acp/DESIGN.md#acp-11-implementation-status).

## Durable binding

Install `@anvia/durable` separately and use the same Node 22.19.0+ runtime for SQLite. Call
`createDurableSessionBinding(runtime, { agent, version, ...registration })` from `@anvia/acp/durable`
once per host-owned runtime/registration, then return that reusable binding from your factory.
The [guide includes a complete host](https://github.com/anvia-hq/anvia/blob/main/docs/packages/acp.md#durable-host).

The supported subset is static instructions/models/local tools with persisted approval/question
responses. Registration still rejects memory, lifecycle callbacks, middleware, guardrails, context
sources, MCP servers, provider tools and tool indexes. ACP additionally rejects editor tools,
binding disposers, `turnBudget` and config changes. Resources must outlive connections.

EOF, connection close and durable `session/close` **detach**, leaving execution/checkpoints and
waits intact. `session/cancel` explicitly cancels pending work without undoing effects. The host
owns `runtime.resume()` and `runtime.close()`; runtime close aborts attempts but retains checkpoints.

After load/resume, send `session/prompt` with **`prompt: []`** to reattach to pending work.
Nonempty prompts return `session_busy` until it settles; empty prompts without pending work are
invalid. Uncommitted text may display again. This convention needs real-editor UX verification.
Durable display projects committed outcomes, not live token deltas or failed attempts.

Keep ACP records and the durable journal together under exclusive ownership; no automatic driver
or registration migration is supported. Uncertain effects require host reconciliation
(`recovery_required`); approval is not reconciliation. Tools default to manual recovery; use `safe`
for repeatable pure work and `idempotent` only when the service deduplicates `operationId`. Delete
requires pending work to be cancelled/settled and removes only ACP records. See the
[supported subset and recovery details](https://github.com/anvia-hq/anvia/blob/main/packages/acp/DESIGN.md#acp-12-implementation-status).

## Compatibility and limits

| Surface               | Support / default                                                                                                                                 |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Protocol / transport  | ACP **v1**, JSON-RPC 2.0 over UTF-8 NDJSON; initialization returns `1` even for another requested version                                         |
| SDK / schema          | Pinned SDK `1.9.0`, stable schema `1.26.0`; schema version differs from protocol integer                                                          |
| Authentication        | `authMethods: []`; initialized `authenticate` is a no-op                                                                                          |
| Sessions              | New/prompt/cancel, isolated history; load/resume/close; list/delete when store implements them (both built-in stores do)                          |
| Output                | Ordered text, stable tool IDs/status, explicit public locations/diffs; plaintext reasoning opt-in                                                 |
| Input                 | Text/resource links (no URI fetching); base64 PNG/JPEG/GIF/WebP and embedded text opt-in                                                          |
| Tools / configuration | Once-only permissions; form questions with client support; opt-in editor fs/terminal, host models/modes/commands                                  |
| Unsupported           | Audio, binary embedded resources, legacy modes, additional directories, fork/system prompt APIs, plans/usage updates, legacy SSE, ACP-proxied MCP |
| v2                    | Disabled; bundled alpha schema is not supported. No v2 entrypoint or remote/multi-user transport                                                  |

| Editor / evidence                         | Verification status                                                                                 |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Raw stdio fixtures / deterministic agents | Automated wire/subprocess coverage; recorded upstream v1 TCK passes, not certification              |
| Zed                                       | Config format checked; ACP 10 GUI run pending (installed version recorded, no interaction verified) |
| JetBrains AI Assistant                    | Config format checked; IDE/plugin run pending                                                       |
| Neovim / CodeCompanion                    | Current documented config shape checked; editor/plugin run pending                                  |

See [CONFORMANCE.md](https://github.com/anvia-hq/anvia/blob/main/packages/acp/test/CONFORMANCE.md) for pinned TCK results and
[EDITOR_COMPATIBILITY.md](https://github.com/anvia-hq/anvia/blob/main/packages/acp/test/EDITOR_COMPATIBILITY.md) for manual acceptance.
Real-editor MCP forwarding, persistence/reconnect, unsaved buffers, terminals and durable attachment
remain unverified. Fixture passes do not establish editor acceptance.

Default `limits`: 32 active sessions (including setup), 64 concurrent RPCs, 16 pending callbacks
per session, 256 blocks, 10 MiB prompt bytes, 1 MiB text, 5 MiB decoded per image, 1,000 history
messages, 16 MiB each for private history/display transcript, 1 MiB terminal output, 10,000 replay
entries and 16 MiB replay bytes. No silent history eviction or partial load replay; stored records
need host retention. See [bounds/hardening](https://github.com/anvia-hq/anvia/blob/main/packages/acp/DESIGN.md#acp-14-implementation-status).

This trusted local host is not an OS sandbox. Admission roots do not confine arbitrary tools or
terminal commands. Errors are sanitized, but public model text and host presentation can expose
what you put into them. Review [SECURITY.md](https://github.com/anvia-hq/anvia/blob/main/packages/acp/SECURITY.md) for MCP launch authority, filesystem
races, private storage and host responsibilities. Internals and
[v2 remaining work](https://github.com/anvia-hq/anvia/blob/main/packages/acp/DESIGN.md#v2-readiness-and-remaining-gaps) stay in DESIGN.md.
