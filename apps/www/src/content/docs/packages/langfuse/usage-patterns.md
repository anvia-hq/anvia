---
title: "@anvia/langfuse: Usage Patterns"
description: "Common ways to compose @anvia/langfuse with adjacent Anvia packages."
section: packages
sidebar:
  group: "@anvia/langfuse"
  order: 3
  label: "Usage Patterns"
---
## Package boundary

`@anvia/langfuse` owns Langfuse-specific tracing, scoring, prompt, dataset, redaction, and experiment integrations. Application code owns trace names, prompt policy, redaction policy, and Langfuse project configuration.

## Common composition

- Attach `langfuse.create(...)` to agents with `AgentBuilder.observe(...)`.
- Use `createLangfuseEvalReporter(...)` for eval scores.
- Use prompt and dataset clients when prompts or cases are managed in Langfuse.

## Do and do not

Do call `flush()` or `shutdown()` in short-lived jobs. Do configure redaction before sending sensitive inputs or outputs. Do record environment, release, and service name.

Do not assume missing traces should always fail evals; configure the reporter behavior. Do not publish raw case inputs if your data policy requires truncation or masking.
