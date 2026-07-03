---
title: Completion panel
description: Build a prompt-to-text completion panel with @anvia/react-ui.
section: react-ui
sidebar:
  group: Examples
  order: 6
  label: Completion panel
---

Use completion primitives when the interface is one prompt and one generated text result rather
than a multi-message chat thread.

```tsx
import { useCompletion } from "@anvia/react";
import { Completion, CompletionProvider } from "@anvia/react-ui";

export function ReleaseNoteDraft() {
  const completion = useCompletion({ endpoint: "/api/completion" });

  return (
    <CompletionProvider controller={completion}>
      <Completion.Root className="completion-panel">
        <Completion.Output>
          {(text) => (
            <article className="completion-result" aria-live="polite">
              {text.length > 0 ? text : "Your draft will appear here."}
            </article>
          )}
        </Completion.Output>

        <Completion.Form className="completion-form">
          <Completion.Input
            rows={5}
            placeholder="Draft a release note for the latest changes..."
          />
          <Completion.Stop>Stop</Completion.Stop>
          <Completion.Submit>Generate</Completion.Submit>
        </Completion.Form>
      </Completion.Root>
    </CompletionProvider>
  );
}
```

```css
.completion-panel {
  display: grid;
  gap: 16px;
}

.completion-result {
  min-height: 180px;
  padding: 16px;
  border: 1px solid var(--border);
  border-radius: 12px;
  white-space: pre-wrap;
}

.completion-form {
  display: grid;
  gap: 10px;
}
```
