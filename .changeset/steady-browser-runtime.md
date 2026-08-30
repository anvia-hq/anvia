---
"@anvia/browser": patch
---

Add supervised Playwright process isolation, capability readiness, bounded lifecycle cancellation,
per-tab concurrent tool scheduling, explicit tab targeting, race-safe human control, and structured
recovery errors while preserving serial selected-tab compatibility.

This patch hardens the existing browser runtime while preserving the default serial selected-tab
workflow. Consumers with structural `BrowserControlSnapshot` test doubles should add the documented
arbitration and availability fields.
