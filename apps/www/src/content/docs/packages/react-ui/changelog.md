---
title: "@anvia/react-ui: Changelog"
description: "Release history for @anvia/react-ui."
section: packages
sidebar:
  group: "@anvia/react-ui"
  order: 5
  label: "Changelog"
---

Release history mirrored from `packages/react-ui/CHANGELOG.md`.

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
