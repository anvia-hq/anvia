---
title: Tool and human input
description: Combine tool-call rendering with approval and question controls in @anvia/react-ui.
section: react-ui
sidebar:
  group: Examples
  order: 4
  label: Tool and human input
---

Tool calls usually live inside assistant messages. Human-input controls usually live near the
composer or in a side panel.

```tsx
import { HumanInput, Message } from "@anvia/react-ui";

export function ToolMessageParts() {
  return (
    <Message.Parts>
      {(part) =>
        part.type === "tool" ? (
          <Message.Part>
            <Message.Tool className="tool-card" renderWhen="always">
              <header className="tool-card-header">
                <Message.ToolName />
                <Message.ToolStatus />
              </header>
              <Message.ToolInput />
              <Message.ToolOutput />
              <Message.ToolError />
            </Message.Tool>
          </Message.Part>
        ) : (
          <Message.Part />
        )
      }
    </Message.Parts>
  );
}

export function ReviewPanel() {
  return (
    <HumanInput.Panel className="review-panel">
      <HumanInput.Status />
      <HumanInput.Approvals className="approvals">
        {(approval) => (
          <HumanInput.Approval className="approval">
            <strong>{approval.toolName}</strong>
            {approval.args !== undefined ? <pre>{approval.args}</pre> : null}
            <HumanInput.ApprovalReason placeholder="Reason for the audit log..." />
            <HumanInput.Reject>Reject</HumanInput.Reject>
            <HumanInput.Approve>Approve</HumanInput.Approve>
          </HumanInput.Approval>
        )}
      </HumanInput.Approvals>
      <HumanInput.Questions className="questions">
        <HumanInput.Question className="question">
          <HumanInput.QuestionPrompt />
          <HumanInput.QuestionSubmit>Submit answer</HumanInput.QuestionSubmit>
        </HumanInput.Question>
      </HumanInput.Questions>
    </HumanInput.Panel>
  );
}
```

## Pending-only activity

Render a compact activity strip by filtering message parts to pending tools.

```tsx
<Message.Parts filter={(part) => part.type === "tool" && part.state !== "output-available"}>
  <Message.Part>
    <Message.Tool renderWhen="pending" className="tool-activity" />
  </Message.Part>
</Message.Parts>
```

## Persistent review lane

Use `keepMounted` when empty approval or question wrappers should still occupy a stable layout area.

```tsx
<aside className="review-lane">
  <HumanInput.Status />
  <HumanInput.Approvals keepMounted />
  <HumanInput.Questions keepMounted />
</aside>
```
