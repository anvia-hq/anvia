---
"@anvia/durable": minor
---

Add running-goal controls. Goals now read indexed `pause:N`, `edit:N`, and `message:N` signals before admitting each session: a pause stops after the current session with pause reason `requested`, an edit replaces the objective or acceptance criteria for later sessions and assessments, and a message reaches exactly one later session. `goalControlSignal(task, family)` returns the next unused signal name. Goals persisted by earlier versions continue unchanged.
