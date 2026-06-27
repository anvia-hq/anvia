---
title: "@anvia/react: Changelog"
description: "Concise release notes and upgrade checks for @anvia/react."
section: packages
sidebar:
  group: "@anvia/react"
  order: 5
  label: "Changelog"
---
## Current version

The package metadata currently reports `@anvia/react@0.5.0`. The latest local changelog section is `0.5.0`.

## Latest local note

ef5e727: Add centralized tool approval handling with tool-level approval policies and `.approvals(...)` decision handlers.

## How to read this changelog

Use this page for a concise package-level summary, then inspect `packages/react/CHANGELOG.md` for the full release history. Entries that only say `Updated dependencies` mean the package was republished with compatible Anvia workspace dependency updates and no package-specific API change was called out.

## Upgrade checks

- Review the matching [Reference](/docs/packages/react/reference) page for public exports used by your application.
- Re-run package-local tests around the integration boundary, especially provider calls, vector-store filters, stream formats, or observer payloads.
- Check peer dependency ranges when combining multiple `@anvia/*` packages in one app.
