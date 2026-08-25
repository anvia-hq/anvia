# @anvia/graph

Provider-neutral schema, extraction, retrieval-context, and tool primitives for knowledge graphs.

```ts
import { defineGraphSchema, extractGraphFacts } from "@anvia/graph";
import { z } from "zod";

const schema = defineGraphSchema({
  nodes: {
    Product: {
      description: "A product or service.",
      identity: ["id"],
      properties: z.strictObject({ id: z.string(), name: z.string() }),
    },
  },
  relationships: {},
});

const facts = await extractGraphFacts({ model, schema, chunks });
```

Database provisioning, persistence, and query execution belong to graph adapter packages such as
`@anvia/neo4j` and `@anvia/memgraph`.
