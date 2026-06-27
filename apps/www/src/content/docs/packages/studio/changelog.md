---
title: "@anvia/studio: Changelog"
description: "Concise release notes and upgrade checks for @anvia/studio."
section: packages
sidebar:
  group: "@anvia/studio"
  order: 5
  label: "Changelog"
---
## Current version

The package metadata currently reports `@anvia/studio@0.7.5`. The latest local changelog section is `0.7.5`.

## Latest local note

9088549: Improve the Dynamic Tools knowledge view with structured tool reference cards, parameter tables, source details, and collapsed raw JSON metadata.

## How to read this changelog

Use this page for a concise package-level summary, then inspect `packages/tool-studio/CHANGELOG.md` for the full release history. Entries that only say `Updated dependencies` mean the package was republished with compatible Anvia workspace dependency updates and no package-specific API change was called out.

## Upgrade checks

- Review the matching [Reference](/docs/packages/studio/reference) page for public exports used by your application.
- Re-run package-local tests around the integration boundary, especially provider calls, vector-store filters, stream formats, or observer payloads.
- Check peer dependency ranges when combining multiple `@anvia/*` packages in one app.
