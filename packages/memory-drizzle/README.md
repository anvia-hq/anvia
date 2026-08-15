# @anvia/memory-drizzle

Drizzle-backed durable session memory store for Anvia.

Use this package when an application already uses Drizzle with PostgreSQL and wants Anvia session
memory to live in the same database and migration workflow.

## Installation

```sh
pnpm add @anvia/memory-drizzle @anvia/core drizzle-orm
```

## Generate Drizzle schema exports

Run the init command from the application root:

```sh
npx @anvia/memory-drizzle init
```

The command is a dry run by default. To write the generated schema export file:

```sh
npx @anvia/memory-drizzle init --write
```

The CLI resolves a schema file from a literal `schema` path in `drizzle.config.*`, then falls back
to `src/db/schema.ts`. By default it creates `anvia-memory.ts` beside that schema. Ensure the
generated file is included by the `schema` setting in your Drizzle config.

To add the exports directly to an existing schema file instead, pass the explicit append flag:

```sh
npx @anvia/memory-drizzle init --write --append-to-schema
```

The append path prints a warning before writing because it modifies the existing TypeScript file.
Use `--schema <path>` when the CLI cannot infer your schema location.

After writing schema changes, run your normal Drizzle migration workflow:

```sh
npx drizzle-kit generate
npx drizzle-kit migrate
```

## Usage

```ts
import { drizzleMemorySchema, createDrizzleMemoryStore } from "@anvia/memory-drizzle";

export const schema = {
  ...drizzleMemorySchema,
};

const memory = createDrizzleMemoryStore(db);
```

This adapter exports the table definitions so users can add the memory schema to
their Drizzle schema instead of copying table shapes by hand.

Its optional read-only memory inspector lets `@anvia/studio` discover existing conversations and
ordered message records directly from these tables.

The store exposes `compaction.snapshot({ scope })` and atomic
`compaction.replacePrefix({ ... })`. Compaction messages remain visible as ordinary ordered system
messages; this adapter never chooses retention, calls a model, or retries mutations.

## Development

```sh
pnpm --filter @anvia/memory-drizzle typecheck
pnpm --filter @anvia/memory-drizzle test
pnpm --filter @anvia/memory-drizzle build
```
