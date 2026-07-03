---
title: Styling
description: Style headless Anvia React UI primitives with class names, data attributes, and optional CSS.
section: react-ui
sidebar:
  group: Primitives
  order: 6
  label: Styling
---

## Headless by default

`@anvia/react-ui` is intentionally headless. The primitives emit semantic behavior, state, and
stable attributes, but the application owns the final visual design.

Every primitive accepts normal element props, including `className`.

```tsx
<Message.Root className="message">
  <Message.Content className="message-content">
    <Message.Parts />
  </Message.Content>
</Message.Root>
```

## Data attributes

Use `data-anvia-*` and `data-state` selectors when class names are not enough.

```css
[data-anvia-message][data-role="user"] {
  justify-self: end;
}

[data-anvia-tool][data-state="output-available"] {
  border-color: var(--success-border);
}
```

## Optional stylesheet

The package ships a minimal stylesheet for quick prototypes.

```tsx
import "@anvia/react-ui/styles.css";
```
