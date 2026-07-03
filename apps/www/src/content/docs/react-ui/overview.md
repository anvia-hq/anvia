---
title: React UI
description: Build Anvia chat, completion, tool-call, and human-input interfaces with composable React primitives.
section: react-ui
sidebar:
  group: Start Here
  order: 1
  label: Overview
---

React UI is the Anvia package for building application-owned AI interfaces. It sits on top of
`@anvia/react`: the hook package owns stream transport and state reduction, while
`@anvia/react-ui` owns composable components, contexts, and behavior.

Use it when you want ChatGPT-style chat surfaces, completion forms, tool call renderers, approval
controls, and question flows without giving up control of markup and styling.

## Prerequisites

React UI assumes three pieces are already in place:

- A React frontend application.
- An API application route that returns Anvia stream events.
- A `useChat(...)` or `useCompletion(...)` controller from `@anvia/react`.

The browser should not call provider SDKs or hold provider credentials. The browser sends messages
to your API app, and your API app runs the model, agent, tools, auth checks, and persistence.

The beginner docs use `http://localhost:5173` for the frontend and `http://localhost:8787` for the
API app. In production, point the hook endpoint at your deployed API origin.

## What to build first

Most applications start with a chat surface:

1. Build an API route that accepts `{ messages, stream: true }`.
2. Create a `useChat(...)` controller that points at that route.
3. Wrap the UI in `ChatProvider`.
4. Render `Thread.Root`, `Thread.Viewport`, `Thread.Messages`, and `Composer.Root`.
5. Keep the default message renderer until a part needs product-specific UI.
6. Add custom Markdown, attachment, tool-card, and human-input rendering one piece at a time.
7. Move layout, colors, spacing, and cards into application CSS or Tailwind classes.

The primitives give you state, accessibility-friendly defaults, and stable attributes. They do not
try to own your design system.

## Package boundary

`@anvia/react-ui` is headless. It provides primitives such as `Thread`, `Composer`, `Message`,
`HumanInput`, and `Completion`, plus stable `data-anvia-*` attributes and an optional stylesheet.

Application code still owns:

- The API route and model selection.
- Auth, persistence, and tenancy.
- Final visual design and design-system integration.
- Custom rendering for domain-specific tool calls.

## Beginner path

- [TanStack quickstart](/docs/react-ui/quickstart-tanstack): build the frontend app and API app first.
- [Server routes](/docs/react-ui/server-routes): understand the route contract.
- [Request shape](/docs/react-ui/request-shape): add model selectors and metadata safely.
- [Chat and composer](/docs/react-ui/chat): learn the thread and prompt primitives.
- [Messages](/docs/react-ui/messages): customize message rows and parts.
- [Lifecycle and state](/docs/react-ui/lifecycle-and-state): handle stop, errors, reset, and retry.

## Example surfaces

- [Full chat surface](/docs/react-ui/examples/chat-surface)
- [Composer attachments](/docs/react-ui/examples/composer-attachments)
- [Message rendering](/docs/react-ui/examples/message-rendering)
- [Tool and human input](/docs/react-ui/examples/tool-human-input)
- [Styling recipe](/docs/react-ui/examples/styling)
- [Completion panel](/docs/react-ui/examples/completion)
- [Tools end to end](/docs/react-ui/tools-end-to-end)
- [Human review end to end](/docs/react-ui/human-review-end-to-end)
- [Attachments end to end](/docs/react-ui/attachments-end-to-end)

## Next pages

- [Getting started](/docs/react-ui/getting-started)
- [TanStack quickstart](/docs/react-ui/quickstart-tanstack)
- [Server routes](/docs/react-ui/server-routes)
- [Request shape](/docs/react-ui/request-shape)
- [Usage patterns](/docs/react-ui/usage-patterns)
- [Chat and composer](/docs/react-ui/chat)
- [Messages](/docs/react-ui/messages)
- [Styling](/docs/react-ui/styling)
- [Tool calls](/docs/react-ui/tool-calls)
- [Human input](/docs/react-ui/human-input)
- [Completion](/docs/react-ui/completion)
- [Lifecycle and state](/docs/react-ui/lifecycle-and-state)
- [Examples](/docs/react-ui/examples)
- [Reference](/docs/react-ui/reference)
- [Changelog](/docs/react-ui/changelog)
