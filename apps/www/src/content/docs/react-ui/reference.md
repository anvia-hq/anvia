---
title: Reference
description: Public imports, namespaces, and styling contracts for @anvia/react-ui.
section: react-ui
sidebar:
  group: Resources
  order: 2
  label: Reference
---

Import from `@anvia/react-ui`.

Subpath entrypoints are also available:

- `@anvia/react-ui/chat`
- `@anvia/react-ui/completion`
- `@anvia/react-ui/human-input`
- `@anvia/react-ui/message`
- `@anvia/react-ui/shared`
- `@anvia/react-ui/styles.css`

## Namespaces

- `Thread`: `Root`, `Viewport`, `Messages`, `Empty`, `ScrollToBottom`
- `Composer`: `Root`, `Input`, `Submit`, `Stop`
- `Message`: `Root`, `Content`, `Parts`, `Part`, `Text`, `Reasoning`, `Tool`, `Data`, `Error`, `Actions`, `Copy`, `Regenerate`
- `HumanInput`: `Approvals`, `Approval`, `Approve`, `Reject`, `Questions`, `Question`, `QuestionPrompt`, `QuestionChoice`, `QuestionSubmit`
- `Completion`: `Root`, `Output`, `Form`, `Input`, `Submit`, `Stop`

## Providers

- `ChatProvider`
- `CompletionProvider`

## Hooks

- `useChatContext`
- `useComposer`
- `useThread`
- `useMessage`
- `useMessagePart`
- `useHumanInput`
- `useApproval`
- `useQuestion`
- `useQuestionPrompt`
- `useCompletionContext`
- `useCompletionInput`

The package reference coverage script checks the package-scoped reference file that mirrors the
published API surface. This page is the product-facing version of the same surface.
