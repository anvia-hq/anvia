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
- `@anvia/react-ui/attachment`
- `@anvia/react-ui/human-input`
- `@anvia/react-ui/message`
- `@anvia/react-ui/shared`
- `@anvia/react-ui/styles.css`

## Namespaces

- `Attachment`: `Root`, `Name`, `Preview`, `Remove`
- `Thread`: `Root`, `Viewport`, `ViewportFooter`, `Messages`, `Empty`, `Status`, `Loading`, `Error`, `Suggestions`, `Suggestion`, `ScrollToBottom`
- `Composer`: `Root`, `Input` (`minRows`, `maxRows`, `autoResize`), `Attachments`, `AttachmentInput`, `AddAttachment`, `AttachmentDropzone`, `Submit`, `Stop`
- `Message`: `Root`, `Content`, `Parts`, `Part`, `Text`, `Markdown`, `CodeBlock`, `Reasoning`, `Tool`, `ToolName`, `ToolInput`, `ToolOutput`, `ToolError`, `ToolStatus`, `Attachment`, `Data`, `Error`, `Actions`, `Copy`, `Regenerate`
- `HumanInput`: `Panel`, `Status`, `Approvals`, `Approval`, `ApprovalReason`, `Approve`, `Reject`, `Questions`, `Question`, `QuestionPrompt`, `QuestionChoice`, `QuestionTextAnswer`, `QuestionSubmit`
- `Completion`: `Root`, `Output`, `Form`, `Input`, `Submit`, `Stop`

## Providers

- `ChatProvider`
- `CompletionProvider`

## Hooks

- `useChatContext`
- `useComposer`
- `useThread`
- `useAttachment`
- `useMessage`
- `useMessagePart`
- `useHumanInput`
- `useApproval`
- `useQuestion`
- `useQuestionPrompt`
- `useCompletionContext`
- `useCompletionInput`

## Headless state controls

- `Composer.Root` accepts uncontrolled defaults (`defaultInput`, `defaultAttachments`) and
  controlled state (`input`, `onInputChange`, `attachments`, `onAttachmentsChange`).
- `Composer.Attachments`, `Thread.Messages`, `Thread.Suggestions`, `HumanInput.Approvals`, and
  `HumanInput.Questions` accept `keepMounted` to control whether an empty wrapper is rendered.
- `useComposer()` exposes `setAttachments(...)` for custom attachment controls.

The package reference coverage script checks the package-scoped reference file that mirrors the
published API surface. This page is the product-facing version of the same surface.
