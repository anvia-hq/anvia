# RAG Search Tool

Give the agent retrieval as a tool, not as pasted context. `createVectorSearchTool`
from `@anvia/core/vector-store` wraps a store + embedding model with a routing
description and `topK`:

```ts
import { Agent } from "@anvia/core/agent";
import { createVectorSearchTool } from "@anvia/core/vector-store";

const searchRunbooks = createVectorSearchTool({
  store,
  model: embeddingModel,
  name: "search_runbooks",
  description: "Search incident runbooks for relevant operational guidance.",
  topK: 2,
});

const agent = new Agent({
  id: "agent",
  model: agentModel,
  instructions: "Use the runbook search tool before answering incident questions.",
  maxTurns: 2,
  tools: [searchRunbooks],
});
```

## Rules

- The tool `description` is routing text: say when to call it, not how vectors
  work. It is optional (a generic default exists), but always set it — the
  default cannot route when several corpora exist. One tool per corpus with a
  distinct description beats one generic `search_docs` tool.
- Keep `topK` small (2–5). The agent reads what the tool returns — large `topK`
  burns context and degrades answers.
- Instruct the agent to call search _before_ answering, and to cite `source`
  metadata from the results. Retrieval without citation requirements produces
  confident paraphrases of nothing.
- For static context that always applies (system rules, tiny glossaries), use
  `Agent.context` (`Document` / `VectorContext`) instead of a tool — tools are
  for corpora too large to fit the prompt.
- Close vector clients (`vectorClient.close()`) when the process ends;
  in-memory stores need no lifecycle.
