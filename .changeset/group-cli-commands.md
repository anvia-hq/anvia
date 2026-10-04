---
"@anvia/cli": minor
---

Group UI commands under `anvia ui init`, `anvia ui add`, and `anvia ui update`, retaining root UI commands as compatibility aliases. Both UI and skills updates preview changes without writing any files, including AGENTS.md, and accept `--apply` to write changes. Legacy `ui update --overwrite` and `skills update --force` remain supported. Reject unknown commands and options and show grouped help.

Generate registry dependencies from the matching React UI package version instead of the independently versioned CLI package.
