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

Use `data-anvia-*`, `data-role`, and `data-state` selectors when class names are not enough.

```css
[data-anvia-message][data-role="user"] {
  justify-self: end;
}

[data-anvia-tool][data-state="output-available"] {
  border-color: var(--success-border);
}

[data-anvia-composer][data-state="streaming"] [data-anvia-submit] {
  display: none;
}
```

## Layout recipe

Package CSS does not create your chat layout. Put viewport sizing, message gaps, bubble alignment,
and composer width in application CSS.

```css
.chat {
  height: 100vh;
  display: grid;
  grid-template-rows: minmax(0, 1fr) auto;
}

.chat-scroll {
  min-height: 0;
  padding: 24px;
}

.messages {
  display: grid;
  gap: 14px;
  width: min(760px, 100%);
  margin: 0 auto;
}

.message {
  display: grid;
  gap: 6px;
}

.message[data-role="user"] {
  justify-items: end;
}

.composer {
  width: min(760px, calc(100% - 32px));
  margin: 0 auto 16px;
  display: flex;
  gap: 8px;
  align-items: end;
}
```

## Optional stylesheet

The package ships a minimal stylesheet for quick prototypes. It keeps functional rules such as
scroll overflow, composer textarea resizing, disabled opacity, media bounds, and code wrapping.
Application CSS should own message layout, cards, spacing, colors, and composer width.

```tsx
import "@anvia/react-ui/styles.css";
```

For a larger CSS recipe, see [Styling recipe](/docs/react-ui/examples/styling).
