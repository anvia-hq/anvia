---
"@anvia/browser": major
---

Add supervised Playwright process isolation, capability readiness, bounded lifecycle cancellation,
per-tab concurrent tool scheduling, explicit tab targeting, race-safe human control, and structured
recovery errors while preserving serial selected-tab compatibility.

This is a major change because a browser handle now permits one active or pending automation connection,
and structural `BrowserControlSnapshot` implementations must provide the new arbitration and
availability fields.
