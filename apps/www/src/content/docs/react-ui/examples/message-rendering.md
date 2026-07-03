---
title: Message rendering
description: Render Markdown, code blocks, attachments, and message actions with @anvia/react-ui.
section: react-ui
sidebar:
  group: Examples
  order: 3
  label: Message rendering
---

This recipe keeps default rendering for most parts and customizes only text, attachments, and tool
parts.

```tsx
import { Message } from "@anvia/react-ui";

export function AgentMessage() {
  return (
    <Message.Root className="message">
      <Message.Content className="message-content">
        <Message.Parts>
          {(part) => {
            if (part.type === "text") {
              return (
                <Message.Part className="text-part">
                  <Message.Markdown
                    components={{
                      code(props) {
                        return <CodeBlock {...props} />;
                      },
                    }}
                  />
                </Message.Part>
              );
            }

            if (part.type === "attachment") {
              return (
                <Message.Part className="attachment-part">
                  <Message.Attachment className="attachment-card" />
                </Message.Part>
              );
            }

            if (part.type === "tool") {
              return (
                <Message.Part>
                  <Message.Tool className="tool-card" renderWhen="always" />
                </Message.Part>
              );
            }

            return <Message.Part />;
          }}
        </Message.Parts>
      </Message.Content>

      <Message.Actions className="message-actions">
        <Message.Copy>Copy</Message.Copy>
        <Message.Regenerate>Retry</Message.Regenerate>
      </Message.Actions>
    </Message.Root>
  );
}
```

## Role-aware layout

`Message.Root` emits `data-role`, so the same component can style user and assistant messages
differently.

```css
.message {
  display: grid;
  gap: 6px;
}

.message[data-role="user"] {
  justify-items: end;
}

.message[data-role="user"] .message-content {
  max-width: min(620px, 88%);
  padding: 10px 14px;
  border-radius: 18px;
  background: var(--user-bubble);
}

.message[data-role="assistant"] .message-content {
  width: min(760px, 100%);
  line-height: 1.7;
}
```

## Copy and regenerate controls

Actions can use regular buttons or design-system components with `asChild`.

```tsx
<Message.Actions className="message-actions">
  <Message.Copy asChild>
    <button type="button">Copy answer</button>
  </Message.Copy>
  <Message.Regenerate asChild>
    <button type="button">Regenerate</button>
  </Message.Regenerate>
</Message.Actions>
```
