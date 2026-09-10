---
"@anvia/cli": minor
---

Add `anvia update` command that compares installed Anvia UI components against the current
registry. It previews out-of-date, modified, and missing files by default and writes updates
with `--overwrite`. Also adds `closestRegistryItemName`, `inspectInstalledItems`, and
`updateInstalledItems` exports with did-you-mean suggestions for unknown item names.
