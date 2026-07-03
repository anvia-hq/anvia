---
title: "@anvia/react-ui: Examples"
description: "Small examples that show @anvia/react-ui at the package boundary."
section: packages
sidebar:
  group: "@anvia/react-ui"
  order: 4
  label: "Examples"
---
## Custom message layout

```tsx
import { Message } from "@anvia/react-ui";

export function ChatMessage() {
  return (
    <Message.Root className="message">
      <Message.Content>
        <Message.Parts />
      </Message.Content>
      <Message.Actions>
        <Message.Copy>Copy</Message.Copy>
        <Message.Regenerate>Try again</Message.Regenerate>
      </Message.Actions>
    </Message.Root>
  );
}
```

## Human approval controls

```tsx
import { HumanInput } from "@anvia/react-ui";

export function PendingApprovals() {
  return (
    <HumanInput.Approvals>
      <HumanInput.Approval>
        <HumanInput.Approve>Approve</HumanInput.Approve>
        <HumanInput.Reject>Reject</HumanInput.Reject>
      </HumanInput.Approval>
    </HumanInput.Approvals>
  );
}
```

## Markdown messages

```tsx
import { Message } from "@anvia/react-ui";

export function MarkdownMessage() {
  return (
    <Message.Root>
      <Message.Parts>
        {(part) =>
          part.type === "text" ? (
            <Message.Part>
              <Message.Markdown />
            </Message.Part>
          ) : (
            <Message.Part />
          )
        }
      </Message.Parts>
    </Message.Root>
  );
}
```

## Composer attachments

```tsx
import { Composer } from "@anvia/react-ui";

export function AttachmentComposer() {
  return (
    <Composer.Root>
      <Composer.Attachments />
      <Composer.AddAttachment>Attach</Composer.AddAttachment>
      <Composer.Input />
      <Composer.Submit />
    </Composer.Root>
  );
}
```

## Completion surface

```tsx
import { useCompletion } from "@anvia/react";
import { Completion, CompletionProvider } from "@anvia/react-ui";

export function CompletionPanel() {
  const completion = useCompletion({ endpoint: "/api/completion" });

  return (
    <CompletionProvider controller={completion}>
      <Completion.Root>
        <Completion.Output />
        <Completion.Form>
          <Completion.Input />
          <Completion.Submit />
        </Completion.Form>
      </Completion.Root>
    </CompletionProvider>
  );
}
```
