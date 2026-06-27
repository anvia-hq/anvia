---
title: "@anvia/core: Usage Patterns"
description: "Common ways to compose @anvia/core with adjacent Anvia packages."
section: packages
sidebar:
  group: "@anvia/core"
  order: 3
  label: "Usage Patterns"
---
## Package boundary

`@anvia/core` owns runtime contracts and orchestration: agents, completion requests, tools, middleware, memory interfaces, extraction, pipelines, embeddings, vector-store contracts, streaming helpers, MCP, skills, evals, and observer events.

Application code owns provider selection, credentials, product data access, route handlers, persistence, and deployment concerns.

## Common composition

- Pair with a provider package such as `@anvia/openai`, `@anvia/anthropic`, `@anvia/gemini`, or `@anvia/mistral`.
- Pair with vector-store packages for retrieval-backed agents.
- Pair with observability packages through `AgentBuilder.observe(...)`.

## Do and do not

Do build application code against the core interfaces when you want provider portability. Do keep tool execution small, typed, and observable. Do test agents through model boundaries and tool harnesses.

Do not put provider SDK calls deep inside agent factories. Do not let tools bypass product authorization. Do not treat memory as a substitute for durable application records.
