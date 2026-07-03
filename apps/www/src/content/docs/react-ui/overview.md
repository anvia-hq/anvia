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

## Package boundary

`@anvia/react-ui` is headless. It provides primitives such as `Thread`, `Composer`, `Message`,
`HumanInput`, and `Completion`, plus stable `data-anvia-*` attributes and an optional stylesheet.

Application code still owns:

- The server route and model selection.
- Auth, persistence, and tenancy.
- Final visual design and design-system integration.
- Custom rendering for domain-specific tool calls.

## Next pages

- [Getting started](/docs/react-ui/getting-started)
- [Usage patterns](/docs/react-ui/usage-patterns)
- [Chat and composer](/docs/react-ui/chat)
- [Messages](/docs/react-ui/messages)
- [Tool calls](/docs/react-ui/tool-calls)
- [Human input](/docs/react-ui/human-input)
- [Completion](/docs/react-ui/completion)
- [Styling](/docs/react-ui/styling)
- [Examples](/docs/react-ui/examples)
- [Reference](/docs/react-ui/reference)
- [Changelog](/docs/react-ui/changelog)
