# @anvia/memory-prisma

Prisma-backed durable session memory store for Anvia agents.

Use this package when an application already uses Prisma and wants Anvia session memory to live in the same database and migration workflow.

| Prisma version | Import                    | Runtime peer                       |
| -------------- | ------------------------- | ---------------------------------- |
| 7              | `@anvia/memory-prisma`    | `@prisma/client >=7.10.0 <8.0.0`   |
| 8 (PostgreSQL) | `@anvia/memory-prisma/v8` | `@prisma/orm-postgres 8.0.0-rc.11` |

Each Prisma peer is optional independently: install the runtime for your chosen entrypoint.
Prisma 8 support is pinned to the tested release candidate, with CLI `prisma@8.0.0-rc.15`.
The instructions immediately below are for Prisma 7; see [Prisma 8](#prisma-8-postgresql)
for its contract and client setup.

## Installation

```sh
pnpm add @anvia/memory-prisma @anvia/core @prisma/client
```

In this monorepo, the package is available through the workspace:

```sh
pnpm --filter @anvia/memory-prisma build
```

## Generate Prisma models

Run the init command from the application root:

```sh
npx @anvia/memory-prisma init
```

The command is a dry run by default. To write the generated Prisma model file:

```sh
npx @anvia/memory-prisma init --write
```

By default it writes `prisma/models/anvia-memory.prisma`. If you need to append to an existing `schema.prisma`, pass the explicit append flag:

```sh
npx @anvia/memory-prisma init --write --append-to-schema
```

The append path prints a warning before writing because it modifies the existing Prisma schema file.

After writing schema changes, run:

```sh
npx prisma@7.10.0 validate
npx prisma@7.10.0 migrate dev --name add_anvia_memory
```

## Usage

```ts
import { Agent } from "@anvia/core";
import { PrismaMemoryStore } from "@anvia/memory-prisma";
import { prisma } from "./db";

const memory = new PrismaMemoryStore({
  client: prisma,
  scopeKey: {
    metadataKeys: ["tenantId"],
  },
});

await memory.validate();

const agent = new Agent({
  id: "support",
  model: model,
  memory: { store: memory, savePolicy: "turn" },
});

await agent.generate({
  prompt: "Where is my order?",
  session: {
    sessionId: "thread_123",
    userId: "user_456",
    metadata: { tenantId: "tenant_789" },
  },
});
```

`scopeKey` defines the database key for one memory thread. By default the key includes `sessionId`
and `userId`; `metadataKeys: ["tenantId"]` also includes `metadata.tenantId`, which isolates memory
across tenants or workspaces. Scope is storage isolation, not authorization.

The Prisma client and its shutdown lifecycle remain caller-owned. `validate()` performs a
non-mutating read-path check; schema creation remains in the application's Prisma migrations.

The store also exposes core's optional read-only memory inspector. When this agent is registered
with `@anvia/studio`, existing Prisma conversations appear automatically on the Memory page. Studio
does not copy the messages or require another schema migration.

When the sessions delegate (including the delegate supplied inside transactions) supports
`findUnique`, the store also exposes
`compaction.snapshot({ scope })` and atomic `compaction.replacePrefix({ ... })`. `load()` and
inspection return the full canonical history; the snapshot projects the session's latest checkpoint
summary plus its unsummarized tail for model context. The generated session model includes nullable
`compactionState`; add it through the application's normal Prisma migration workflow. With narrower
custom delegates the capability is absent, rather than pretending checkpoint updates are atomic.

## Custom delegates

The default client path expects Prisma delegates named `agentMemorySession`, `agentMemoryMessage`, and `agentMemoryError`. If your app uses custom model names, pass delegates explicitly:

```ts
const memory = new PrismaMemoryStore({
  delegates: {
    sessions: prisma.customMemorySession,
    messages: prisma.customMemoryMessage,
    errors: prisma.customMemoryError,
    transaction: (operation, options) =>
      prisma.$transaction(
        (tx) =>
          operation({
            sessions: tx.customMemorySession,
            messages: tx.customMemoryMessage,
            errors: tx.customMemoryError,
            transaction: async (nested) =>
              nested({
                sessions: tx.customMemorySession,
                messages: tx.customMemoryMessage,
                errors: tx.customMemoryError,
                transaction: async () => {
                  throw new Error("Nested transactions are not supported.");
                },
              }),
          }),
        options,
      ),
  },
});
```

Custom delegates continue to work without inspection. To make them discoverable by Studio, the
sessions delegate must also expose Prisma-compatible `findMany(...)` and `findUnique(...)` methods.

## Prisma 8 (PostgreSQL)

Use Node.js 22.18+ (24.11+ on the Node 24 line) and TypeScript 5.9+. Prisma 8 has its own
runtime, query API, and contract workflow. The `/v8` store provides the same memory behavior,
including inspection and compaction, through a caller-owned PostgreSQL client.

```sh
pnpm add @anvia/memory-prisma @anvia/core @prisma/orm-postgres@8.0.0-rc.11
pnpm add -D prisma@8.0.0-rc.15
pnpm exec anvia-memory-prisma init --prisma-version 8 --contract src/prisma/contract.prisma
```

The command previews a single PSL contract. Add `--write` to create it. If your contract
already exists, also pass `--append-to-contract`. Replacing an existing generated block
requires `--force`; content outside that block is preserved. Existing conflicting models
and malformed markers are rejected. TypeScript contracts are not edited by this CLI.

Configure the local Prisma 8 CLI:

```ts
// prisma.config.ts
import { definePrismaConfig } from "prisma/config";
import { defineConfig } from "@prisma/orm-postgres/config";

export default definePrismaConfig({
  orm: defineConfig({
    contract: "src/prisma/contract.prisma",
    output: "src/prisma/generated",
    db: { connection: process.env.DATABASE_URL },
  }),
});
```

For a **new database**, emit the contract, review the proposed changes, and create the tables:

```sh
pnpm exec prisma contract emit
pnpm exec prisma db update --dry-run
pnpm exec prisma db update
```

Create the client and store (relative paths below assume `src/prisma/db.ts`):

```ts
import postgres from "@prisma/orm-postgres/runtime";
import { PrismaMemoryStore } from "@anvia/memory-prisma/v8";
import type { Contract } from "./generated/contract.js";
import contractJson from "./generated/contract.json" with { type: "json" };

export const db = postgres<Contract>({
  url: process.env.DATABASE_URL!,
  contractJson,
});
export const memory = new PrismaMemoryStore({
  client: db,
  scopeKey: { metadataKeys: ["tenantId"] },
});
await memory.validate();

// On application shutdown, the caller closes the client:
// await db.close();
```

Enable `resolveJsonModule` and an import-attribute-compatible module setting such as
`module: "ESNext"` with `moduleResolution: "Bundler"`. Include the generated declarations
in your TypeScript project. Re-run `contract emit` after contract changes.

### Existing Prisma 7 memory tables

Both clients can use the same PostgreSQL tables. Keep Prisma 7 in charge of migrations
during the transition; changing the memory-store import does not transfer migration ownership.
Follow Prisma's [side-by-side migration guide](https://www.prisma.io/docs/guides/upgrade-prisma-orm/postgresql)
to separate the CLIs and configs. Anvia's default `init` recognizes `prisma7.config.ts`
(also `.mts`, `.js`, and `.mjs`) before `prisma.config.ts`.

1. Infer a Prisma 8 contract from the existing database with the local Prisma 8 CLI:
   `pnpm exec prisma contract infer --output src/prisma/contract.prisma`.
2. Review the contract. Exclude Prisma 7's migration ledger from Prisma 8 management.
   Preserve explicit table mappings (`@@map("AgentMemorySession")`, etc.), indexes,
   constraints, and cascading relations. All Anvia scalar and relation names must match
   the generated memory contract; model names may be customized below.
3. Preserve the existing PostgreSQL types: text IDs, `Jsonb` fields, nullable
   `compactionState`, and `TimestampString(3)` for `createdAt` and `updatedAt`.
   Use `@default(cuid(2))` for new IDs and keep existing IDs unchanged. Retain
   `@default(now())` on `createdAt` for schema compatibility. Anvia explicitly supplies
   UTC `createdAt` values for new sessions, messages, and errors, and UTC `updatedAt`
   values on every session upsert, independently of PostgreSQL's session timezone.
   Existing creation timestamps are preserved. If your tables were customized, match their storage
   mapping before use; the generated block targets the standard Anvia schema.
4. Emit the reviewed contract. While Prisma 7 owns migrations, create the Prisma 8 client
   with `verifyMarker: false`; its marker has not been established by Prisma 8 migrations.
   Re-emit the reviewed contract after Prisma 7 schema changes.
5. Switch the store import to `/v8` and pass the Prisma 8 client. Messages, IDs, and
   compaction checkpoints remain in place. Run `memory.validate()` before serving requests.

Do not append another set of memory models when they already exist in the inferred contract.
Existing installations without `compactionState` must add that field through the application's
normal migration workflow first. Transfer migration ownership later using Prisma's documented
baseline/ref procedure; Anvia never runs migrations automatically.

### Model mappings and transactions

```ts
const memory = new PrismaMemoryStore({
  client: db,
  schema: "public",
  models: {
    sessions: "CustomSession",
    messages: "CustomMessage",
    errors: "CustomError",
  },
});
```

Mappings select models from `db.orm[schema]` and are also applied inside transactions.
Keep field names and the `messages`/`memorySession` relations compatible with the generated
contract. For a contract without an error model, set `models.errors: null` and
`errorPolicy: "ignore"`. Prisma 7 custom `delegates` remain available through the root
entrypoint; the Prisma 8 entrypoint uses model mappings instead.

`transaction.isolationLevel` accepts `ReadUncommitted`, `ReadCommitted`, `RepeatableRead`,
and `Serializable`. The adapter sets PostgreSQL transaction isolation before data queries;
compaction always uses `Serializable`. Serialization failures propagate to the caller
(`sqlState: "40001"`); retry the whole operation, taking a new compaction snapshot when
needed. The store does not add automatic retries or close caller-owned clients.

## Development

```sh
pnpm --filter @anvia/memory-prisma typecheck
pnpm --filter @anvia/memory-prisma test
pnpm --filter @anvia/memory-prisma build
```

Real-client checks live in `tests/integration/memory-prisma`. See its README for PostgreSQL
setup and cross-version tests. Public docs outside this repository should include the `/v8`
entrypoint and the separate Prisma 8 installation and contract workflow above.
