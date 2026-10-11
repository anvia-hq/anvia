---
"@anvia/durable": minor
"@anvia/client": patch
"@anvia/server": patch
---

Add running-goal controls. Goals now read indexed `pause:N`, `edit:N`, and `message:N` signals before admitting each session: a pause stops after the current session with pause reason `requested`, an edit replaces the objective or acceptance criteria for later sessions and assessments, and a message reaches exactly one later session. `goalControlSignal(task, family)` returns the next unused signal name. Goals persisted by earlier versions continue unchanged. Assessments may also return `context`, which reaches the next session inside `previous`, so later sessions can build on the previous answer and changed files. `@anvia/client` and `@anvia/server` accept `@anvia/durable` 0.8 and 0.9.
