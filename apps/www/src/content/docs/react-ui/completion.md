---
title: Completion
description: Build prompt-to-text completion surfaces with @anvia/react-ui.
section: react-ui
sidebar:
  group: Primitives
  order: 5
  label: Completion
---

## Completion provider

`CompletionProvider` binds a `useCompletion(...)` controller from `@anvia/react` to completion
primitives.

```tsx
import { useCompletion } from "@anvia/react";
import { Completion, CompletionProvider } from "@anvia/react-ui";

export function CompletionSurface() {
  const completion = useCompletion({ endpoint: "/api/completion" });

  return (
    <CompletionProvider controller={completion}>
      <Completion.Root className="completion">
        <Completion.Output className="completion-output" />
        <Completion.Form className="completion-form">
          <Completion.Input placeholder="Write a prompt..." />
          <Completion.Submit />
          <Completion.Stop />
        </Completion.Form>
      </Completion.Root>
    </CompletionProvider>
  );
}
```

## Output

`Completion.Output` renders the current completion text. Pass a function child when the app needs to
wrap, transform, or decorate the streamed text.

```tsx
<Completion.Output>{(text) => <article className="result">{text}</article>}</Completion.Output>
```

`Completion.Submit` is enabled only when input is available and the controller is not streaming.
`Completion.Stop` is enabled only while streaming.
