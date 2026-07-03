---
title: Human input
description: Render tool approvals and tool questions from Anvia chat state.
section: react-ui
sidebar:
  group: Primitives
  order: 4
  label: Human input
---

## Panel

`HumanInput.Panel` renders when pending approvals or questions exist. Use `HumanInput.Status` when
the surface should show a pending count.

```tsx
<HumanInput.Panel className="human-input-panel">
  <HumanInput.Status />
  <HumanInput.Approvals />
  <HumanInput.Questions />
</HumanInput.Panel>
```

If your application wants a persistent review lane, render the collections directly with
`keepMounted`.

```tsx
<aside className="review-lane">
  <HumanInput.Status />
  <HumanInput.Approvals keepMounted />
  <HumanInput.Questions keepMounted />
</aside>
```

## Approvals

`HumanInput.Approvals` reads approvals from the chat controller. Each approval gets its own context
so `HumanInput.Approve` and `HumanInput.Reject` know which request to resolve.

```tsx
<HumanInput.Approvals className="approvals">
  {(approval) => (
    <HumanInput.Approval className="approval">
      <header>
        <strong>{approval.toolName}</strong>
        <span>{approval.status}</span>
      </header>
      {approval.args !== undefined ? <pre>{approval.args}</pre> : null}
      <HumanInput.ApprovalReason placeholder="Why approve or reject?" />
      <div className="approval-actions">
        <HumanInput.Reject>Reject</HumanInput.Reject>
        <HumanInput.Approve>Approve</HumanInput.Approve>
      </div>
    </HumanInput.Approval>
  )}
</HumanInput.Approvals>
```

Use `filter="all"` when a review surface should show completed approvals too. The default filter is
`"pending"`.

```tsx
<HumanInput.Approvals filter="all" />
```

## Questions

`HumanInput.Questions` renders pending tool questions. A question can contain one or more prompts,
and each prompt can expose multiple choices.

```tsx
<HumanInput.Questions>
  <HumanInput.Question className="question">
    <HumanInput.QuestionPrompt />
    <HumanInput.QuestionSubmit>Answer</HumanInput.QuestionSubmit>
  </HumanInput.Question>
</HumanInput.Questions>
```

When a prompt has no choices, the default prompt renderer shows `HumanInput.QuestionTextAnswer`.
Use it directly when a custom question layout needs free-text answers.

```tsx
import { HumanInput, useQuestionPrompt } from "@anvia/react-ui";

function QuestionPromptFields() {
  const { prompt } = useQuestionPrompt();

  return (
    <div className="question-prompt">
      <label>{prompt.question}</label>
      {prompt.choices.length > 0 ? (
        prompt.choices.map((choice) => (
          <HumanInput.QuestionChoice key={choice.value} value={choice.value}>
            {choice.label}
          </HumanInput.QuestionChoice>
        ))
      ) : (
        <HumanInput.QuestionTextAnswer placeholder="Type an answer..." />
      )}
    </div>
  );
}

export function CustomQuestionPrompt() {
  return (
    <HumanInput.QuestionPrompt>
      <QuestionPromptFields />
    </HumanInput.QuestionPrompt>
  );
}
```

For a combined tool and review flow, see [Tool and human input](/docs/react-ui/examples/tool-human-input).
