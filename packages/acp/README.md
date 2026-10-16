# @anvia/acp

Agent-side [Agent Client Protocol](https://agentclientprotocol.com/libraries/typescript)
adapter for Anvia. Applications supply their own agents, models, tools, and credentials.

**Current status: ACP 02 transport scaffold.** The package supports stable v1 initialization,
no-op authentication, NDJSON transport, and a dedicated launcher. Session creation, prompts,
streaming, cancellation, and editor tools are subsequent tasks. This is not yet a usable
editor chat agent: session methods return JSON-RPC method-not-found (`-32601`).

## Launcher

```sh
pnpm add @anvia/acp @anvia/core
pnpm exec anvia-acp ./agent.mjs
```

The single argument is a trusted local module path, resolved against the launch directory.
Use compiled JavaScript (`.mjs`, or `.js` in an ESM project). TypeScript requires a caller-supplied
Node loader; the launcher does not transpile it or install dependencies.

Export a named `sessionFactory`, a default factory, or a named/default Anvia `Agent`:

```js
import { Agent } from "@anvia/core/agent";
import { model } from "./model.js"; // Your provider and credential configuration.

export function sessionFactory(context) {
  return {
    agent: new Agent({
      id: context.sessionId,
      model,
      mcpServers: context.mcpServers,
      tools: [...context.editorTools],
    }),
    // Optional: dispose() for session-owned resources.
  };
}
```

Factories are loaded and validated as functions at startup; they will be called by the future
session manager, never during `initialize`. A directly exported agent is constructed during
module import and normalized to a single-use factory, preventing reuse across sessions.
Prefer a factory for multiple sessions. Named `sessionFactory` takes precedence over default
exports; a default export takes precedence over named `agent`.

The launcher reserves stdout for protocol traffic before importing the module. `console`
methods and `process.stdout.write` go to stderr, including startup diagnostics and help.
Application code must not bypass this with direct writes to file descriptor 1 or inherited
child stdout. Spawn tools with piped output or stderr explicitly. The launcher executes trusted
application code; it is not a sandbox.

No auth methods are advertised. Schema-valid `authenticate` requests return `{}` after
initialization. The module owns credential configuration; import errors produce a generic
stderr diagnostic and exit status 1 without printing the raw error or stack.

## Library

```ts
import { createAcpConnection } from "@anvia/acp";
import { serveStdio } from "@anvia/acp/stdio";
import { sessionFactory } from "./agent.js";

const connection = serveStdio({ sessionFactory });
await connection.closed;
// Or: await connection.close(); // Idempotent.

// For caller-owned Web byte streams:
// createAcpConnection({ sessionFactory, input, output });
```

`serveStdio` also accepts Node `input`/`output` streams. The library does not replace the global
console, attach process signal handlers, or run providers on import. Library hosts must route
their own logs to stderr and own shutdown. Closing cancels the input reader but does not close
the caller's output stream. `closed` resolves on EOF, explicit close, or transport failure.

Optional settings are `agentInfo: { name, version, title? }` and `maxMessageBytes` (10 MiB by
default). Oversized input closes the connection through the SDK's bounded NDJSON reader.
`initialize` always returns protocol version `1`, including when another version is requested,
as specified by [ACP version negotiation](https://agentclientprotocol.com/protocol/v1/initialization).
All optional prompt, persistence, and MCP transport capabilities are disabled. Local/editor
filesystem and terminal tools are not installed. Unknown methods return `-32601`, invalid
params return `-32602`, malformed JSON returns `-32700`, and invalid envelopes return `-32600`.

## Offline smoke test

From the repository root:

```sh
pnpm --filter @anvia/acp build
node packages/acp/dist/cli.js packages/acp/examples/sample-agent.mjs
```

Send this newline-terminated request on stdin:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "initialize",
  "params": { "protocolVersion": 1, "clientCapabilities": {} }
}
```

Expect a response with `protocolVersion: 1`, `authMethods: []`, and disabled optional
capabilities. The sample constructs a real Anvia agent with an offline fixture model; no API
key is needed. EOF, SIGINT, and SIGTERM stop the transport.

`pnpm --filter @anvia/acp test` builds the package and runs unit and real subprocess tests.
The subprocess tests exercise the built bin, sample agent, factory loading, stdout isolation,
startup errors, EOF, and signals. These are handshake tests, not editor compatibility claims.

Manual editor verification belongs to ACP 10 after session execution exists:

- Configure Zed and one JetBrains/Neovim client with the built launcher and an absolute module path.
- Record editor versions; verify the handshake and stderr/stdout separation.
- Once implemented, exercise two chat turns, approval/denial, cancellation, MCP, and subprocess exit.

See [DESIGN.md](./DESIGN.md) for the proposed contract and later task boundaries. External
documentation should describe this as a scaffold until session execution is available.
