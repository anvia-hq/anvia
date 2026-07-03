---
title: "@anvia/react-ui: Overview"
description: "Composable React UI primitives for Anvia chat and completion experiences."
section: packages
sidebar:
  group: "@anvia/react-ui"
  order: 1
  label: "Overview"
---
## What it is

Composable React UI primitives for Anvia chat and completion experiences.

Use `@anvia/react-ui` when an application wants accessible, unstyled building blocks on top of `@anvia/react` hooks instead of hand-wiring every message list, composer, completion form, tool call, and human-input control.

## Where it fits

`@anvia/react` owns hooks, transports, and stream reduction. `@anvia/react-ui` owns React component behavior and context composition.

The package is intentionally headless. It emits stable `data-anvia-*` attributes and provides an optional stylesheet at `@anvia/react-ui/styles.css`, but application code owns the final visual design.

## Public surface

The main documented exports are `ChatProvider`, `CompletionProvider`, `Thread`, `Composer`, `Message`, `Completion`, and `HumanInput`. The reference page lists the package entrypoints and public symbols that are checked by the docs reference coverage script.

## Next pages

- [Getting Started](/docs/packages/react-ui/getting-started)
- [Usage Patterns](/docs/packages/react-ui/usage-patterns)
- [Examples](/docs/packages/react-ui/examples)
- [Changelog](/docs/packages/react-ui/changelog)
- [Reference](/docs/packages/react-ui/reference)
