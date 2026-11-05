---
"@anvia/durable": minor
---

Admit observational lifecycle hooks. Set `lifecycle: { mode: "observe" }` on a registration and the agent's `onStart`, `onStepFinish`, `onToolStart`, `onToolFinish`, `onFinish` and `onError` hooks run at most once per step. Each invocation is recorded before the hook runs, so a restart or retry does not repeat it. A throwing hook is recorded and does not fail the run. Without the marker, `lifecycle` is still rejected at registration.
