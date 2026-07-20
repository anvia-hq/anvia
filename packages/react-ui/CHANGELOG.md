# @anvia/react-ui

## 0.6.0

### Minor Changes

- 129f37c: Replace stream animation presets with lifecycle-driven, buffered smoothing for text and ordered
  mixed items. Add stable-block live Markdown rendering and use the pipeline in the Studio Playground
  transcript.

## 0.5.1

### Patch Changes

- 433f642: Simplify conditional UI property construction while preserving rendered behavior and the public API.

## 0.5.0

### Minor Changes

- bc1aef3: Render validated Composer entities as headless semantic markup in `Message.Markdown`, with `Message.Entity` and `renderEntity` customization APIs.

### Patch Changes

- feb5955: Keep Composer entity ranges aligned when default submission prefixes message text with a quote.

## 0.4.3

### Patch Changes

- 6448b3e: Add opt-in, reduced-motion-aware display smoothing for streamed text and Markdown without changing chat state or transport behavior.

## 0.4.2

### Patch Changes

- 072451a: Make `Composer.Input` lifecycle-safe when trigger changes recreate its Tiptap editor.

## 0.4.1

### Patch Changes

- b8bb855: Clear the default chat composer immediately after starting message submission instead of waiting for the response stream.

## 0.4.0

### Minor Changes

- 3898f6d: Add a Tiptap-backed rich `Composer.Input` with composable trigger/entity metadata support.

  `Composer.Input` now renders a rich editor instead of a native textarea. Use
  `Composer.TextareaInput` for the previous textarea behavior.

## 0.3.0

### Minor Changes

- 0bdb305: Add Image, SelectionToolbar, and ThreadList primitive namespaces. Composer now supports controlled quote state for selection quoting, and message roots expose stable message id attributes for selection-aware UI.

## 0.2.0

### Minor Changes

- 7b398eb: Add composable React UI primitives for Anvia chat, completion, message parts, and human-input workflows.
  Merge raw agent tool-call results back into the originating tool part when provider and internal call ids differ.
  Add UI attachment contracts, chat suggestions, composer attachments, auto-resizing composer input, Markdown rendering, granular tool primitives, thread status helpers, expanded human-input controls, controlled composer state, custom composer submit handlers, optional empty collection mounting, and thinner headless defaults.

## 0.1.0

### Minor Changes

- Add composable React UI primitives for Anvia chat, completion, message parts, and human-input workflows.
