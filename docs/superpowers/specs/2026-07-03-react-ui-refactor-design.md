# React UI Refactor Design

## Goal

Refactor `@anvia/react-ui` to improve maintainability, accessibility, test coverage, and small behavior edge cases while preserving the existing public import surface.

## Scope

This work covers the recommended safe refactor:

- Split large implementation files into focused internal modules.
- Keep public entrypoints and current runtime component namespaces compatible.
- Add exported component prop types for wrappers and custom composition.
- Improve CSS scoping so default styles do not affect unrelated app elements.
- Fix targeted behavior issues in message actions and human-input questions.
- Expand tests until the existing package coverage thresholds pass.

This work does not introduce a visual redesign, new dependencies beyond what is already present, or breaking removal of existing props.

## Current Issues

`packages/react-ui/src/internal.tsx` mixes context declarations, public types, providers, primitive rendering helpers, ref composition, and formatting helpers. `chat.tsx`, `message.tsx`, and `human-input.tsx` each contain multiple primitive families in a single file. This makes focused testing and future edits harder than necessary.

The current coverage script fails the configured 80% thresholds. A few behavior details also need hardening:

- `[data-state="disabled"]` in `styles.css` is globally scoped.
- `Message.Regenerate` is enabled for any assistant message even though `chat.regenerate()` regenerates from the latest user message.
- `Message.Copy` does not expose failure state when the Clipboard API is unavailable or rejects.
- Multi-prompt tool questions can be submitted after answering only one prompt.
- Answered tool questions do not seed existing answers when rendered with `filter="all"`.

## Architecture

Public top-level source files remain stable barrels:

- `src/index.ts`
- `src/chat.tsx`
- `src/completion.tsx`
- `src/human-input.tsx`
- `src/message.tsx`
- `src/shared.ts`

Implementation moves into focused folders:

```txt
src/
  chat/
    composer.tsx
    thread.tsx
    index.ts
  completion/
    index.tsx
  human-input/
    approvals.tsx
    questions.tsx
    index.ts
  message/
    actions.tsx
    parts.tsx
    index.ts
  shared/
    contexts.tsx
    format.ts
    primitive.tsx
    index.ts
```

The package `exports` map stays unchanged. `tsup` may use a config file or the existing command, but the built entrypoints must remain the same.

## Public API

Existing namespaces remain available:

- `Thread`
- `Composer`
- `Message`
- `Completion`
- `HumanInput`

Existing providers and hooks remain available. New exported type aliases should be additive and named after the public components, for example `ThreadViewportProps`, `ComposerInputProps`, `MessageToolProps`, and `HumanInputQuestionSubmitProps`.

The refactor should not remove `asChild`, existing children render functions, subpath exports, or default primitive rendering behavior.

## Behavior Details

### CSS scoping

The default stylesheet should scope disabled opacity to Anvia-owned primitives instead of all `[data-state="disabled"]` elements. Error styles should remain scoped to Anvia error markers.

### Regenerate action

`Message.Regenerate` should only be enabled when the current message is the latest assistant message in the chat controller. It should stay disabled while streaming and for non-assistant messages.

### Copy action

`Message.Copy` should maintain a small state machine such as `idle`, `copied`, and `error`. Clipboard failures should not throw through React event handlers. The component should emit this state through `data-state` so apps can style success and failure.

### Human-input questions

`HumanInput.QuestionSubmit` should require an answer for every prompt in the current question before submitting. `QuestionProvider` should initialize local answers from `question.answers` when present so answered historical questions render selected choices.

`HumanInput.QuestionChoice` should set `aria-pressed` based on the selected state.

## Testing Strategy

Use TDD for each behavior change:

1. Add a failing test for the expected behavior.
2. Run the focused test and confirm it fails for the expected reason.
3. Implement the minimal production change.
4. Run the focused test and confirm it passes.
5. Run package test, typecheck, coverage, build, and Biome check before handoff.

Coverage should pass the existing 80% global thresholds without lowering them.

Key tests:

- `Message.Regenerate` disables older assistant messages and enables only the latest assistant message.
- `Message.Copy` handles Clipboard API success, missing API, and rejected writes.
- `HumanInput.QuestionSubmit` requires all prompts answered.
- `QuestionProvider` seeds existing answers for answered questions.
- Public subpath imports and exported prop types compile.
- CSS scoped disabled selector no longer contains a bare `[data-state="disabled"]` rule.

## Documentation

Update package docs only if public exports or behavior descriptions change. The package reference docs should mention any newly exported prop types if the reference coverage script requires them.

## Acceptance Criteria

- Public imports remain compatible.
- Large source files are split into focused modules with clear responsibilities.
- Behavior fixes above are implemented and covered by tests.
- Existing coverage thresholds pass.
- `pnpm exec biome check packages/react-ui` passes.
- `pnpm --filter @anvia/react-ui typecheck` passes.
- `pnpm --filter @anvia/react-ui test` passes.
- `pnpm --filter @anvia/react-ui coverage` passes.
- `pnpm --filter @anvia/react-ui build` passes.
- `pnpm --filter www reference-check` passes if public docs metadata changes.
