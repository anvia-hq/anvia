---
title: Human input
description: Render tool approvals and tool questions from Anvia chat state.
section: react-ui
sidebar:
  group: Primitives
  order: 4
  label: Human input
---

## Approvals

`HumanInput.Approvals` reads pending approvals from the chat controller. Each approval gets its own
context so `HumanInput.Approve` and `HumanInput.Reject` know which request to resolve.

```tsx
<HumanInput.Approvals className="approvals">
  {(approval) => (
    <HumanInput.Approval className="approval">
      <strong>{approval.toolName}</strong>
      <pre>{approval.args}</pre>
      <HumanInput.Approve />
      <HumanInput.Reject />
    </HumanInput.Approval>
  )}
</HumanInput.Approvals>
```

Use `filter="all"` when a review surface should show completed approvals too. The default filter is
`"pending"`.

## Questions

`HumanInput.Questions` renders pending tool questions. A question can contain one or more prompts,
and each prompt can expose multiple choices.

```tsx
<HumanInput.Questions>
  <HumanInput.Question>
    <HumanInput.QuestionPrompt />
    <HumanInput.QuestionSubmit />
  </HumanInput.Question>
</HumanInput.Questions>
```
