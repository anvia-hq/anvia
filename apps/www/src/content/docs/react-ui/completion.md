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
          <Completion.Submit>Complete</Completion.Submit>
          <Completion.Stop>Stop</Completion.Stop>
        </Completion.Form>
      </Completion.Root>
    </CompletionProvider>
  );
}
```

## Custom output

`Completion.Output` renders the current completion text. Pass a function child when the app needs
to wrap, transform, or decorate streamed text.

```tsx
<Completion.Output>
  {(text) => (
    <article className="completion-result" aria-live="polite">
      {text.length > 0 ? text : "The generated draft will appear here."}
    </article>
  )}
</Completion.Output>
```

## App-owned form controls

Use `asChild` when a design system owns the actual buttons.

```tsx
<Completion.Form className="completion-form">
  <Completion.Input rows={4} placeholder="Draft a release note..." />
  <Completion.Stop asChild>
    <button type="button">Stop</button>
  </Completion.Stop>
  <Completion.Submit asChild>
    <button type="submit">Generate</button>
  </Completion.Submit>
</Completion.Form>
```

`Completion.Submit` is enabled only when input is available and the controller is not streaming.
`Completion.Stop` is enabled only while streaming.

For a complete completion panel, see [Completion panel](/docs/react-ui/examples/completion).
