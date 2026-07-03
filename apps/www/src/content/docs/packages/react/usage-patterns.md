---
title: "@anvia/react: Usage Patterns"
description: "Common ways to compose @anvia/react with adjacent Anvia packages."
section: packages
sidebar:
  group: "@anvia/react"
  order: 3
  label: "Usage Patterns"
---
## Package boundary

`@anvia/react` owns browser-side state and transport consumption. It should call an application endpoint that owns auth, model selection, and execution.

## Common composition

- Pair `useChat(...)` with a JSONL or SSE endpoint built with `@anvia/server`.
- Use `useCompletion(...)` for single-prompt streaming text surfaces.
- Use `createDirectTransport(...)` for tests, demos, or in-process examples.
- Use `@anvia/react-ui` when you want ready-made headless primitives for thread, message,
  composer, completion, tool-call, and human-input UI.

Default hook requests send `{ messages, stream: true }`. Server routes should read
`body.messages` when they are called by `useChat(...)` or `useCompletion(...)`.

## Do and do not

Do keep API keys and provider clients on the server. Do expose pending tool approvals and human questions through the hook state. Do test stream parsing separately from visual components.

Do not make the browser responsible for provider fallback. Do not store privileged tool results in component state longer than needed. Do not assume every endpoint uses the same stream format.
