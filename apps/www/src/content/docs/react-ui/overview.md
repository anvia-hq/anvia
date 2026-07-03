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

## What to build first

Most applications start with a chat surface:

1. Create a `useChat(...)` controller in the app.
2. Wrap the UI in `ChatProvider`.
3. Render `Thread.Root`, `Thread.Viewport`, `Thread.Messages`, and `Composer.Root`.
4. Keep the default message renderer until a part needs product-specific UI.
5. Add custom Markdown, attachment, tool-card, and human-input rendering one piece at a time.
6. Move layout, colors, spacing, and cards into application CSS or Tailwind classes.

The primitives give you state, accessibility-friendly defaults, and stable attributes. They do not
try to own your design system.

## Package boundary

`@anvia/react-ui` is headless. It provides primitives such as `Thread`, `Composer`, `Message`,
`HumanInput`, and `Completion`, plus stable `data-anvia-*` attributes and an optional stylesheet.

Application code still owns:

- The server route and model selection.
- Auth, persistence, and tenancy.
- Final visual design and design-system integration.
- Custom rendering for domain-specific tool calls.

## Example surfaces

- [Full chat surface](/docs/react-ui/examples/chat-surface)
- [Composer attachments](/docs/react-ui/examples/composer-attachments)
- [Message rendering](/docs/react-ui/examples/message-rendering)
- [Tool and human input](/docs/react-ui/examples/tool-human-input)
- [Styling recipe](/docs/react-ui/examples/styling)
- [Completion panel](/docs/react-ui/examples/completion)

## Next pages

- [Getting started](/docs/react-ui/getting-started)
- [Usage patterns](/docs/react-ui/usage-patterns)
- [Chat and composer](/docs/react-ui/chat)
- [Messages](/docs/react-ui/messages)
- [Styling](/docs/react-ui/styling)
- [Tool calls](/docs/react-ui/tool-calls)
- [Human input](/docs/react-ui/human-input)
- [Completion](/docs/react-ui/completion)
- [Examples](/docs/react-ui/examples)
- [Reference](/docs/react-ui/reference)
- [Changelog](/docs/react-ui/changelog)
