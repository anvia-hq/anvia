---
"@anvia/sandbox": minor
---

Use `/bin/bash -c` for natural command lines when Bash is available, falling back to `sh -c` only when `/bin/bash` is not executable. This fixes brace expansion and Bash conditionals on Debian images where `/bin/sh` is dash. Cache a bounded, read-only availability probe per live sandbox runtime, and give `start_process` the same command-line handling as `exec_command`.

Policies still require explicit shell permission and check the selected executable: allow `/bin/bash` for automatic Bash selection and `sh` for fallback. A policy that permits only `sh` rejects automatic Bash selection; block-mode policies still reject natural command lines. Preserve POSIX behavior with explicit `{ command: "sh", args: ["-c", script] }`. Explicit argv and the low-level runtime APIs retain their existing behavior.
