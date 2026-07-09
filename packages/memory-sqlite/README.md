# @anvia/memory-sqlite

SQLite-backed durable session memory store for Anvia.

```ts
import { createSqliteMemoryStore } from "@anvia/memory-sqlite";

const memory = createSqliteMemoryStore({
  path: "data/anvia-memory.sqlite",
});
```

The package creates the Anvia memory tables by default and stores ordered
`Message[]` rows keyed by the session scope.
