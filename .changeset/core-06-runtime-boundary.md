---
"@anvia/core": patch
---

Validate dense and sparse embedding counts for each provider batch before flattening or document regrouping. Reject malformed successful batches without retrying, and preserve accepted batch containers while concurrent siblings finish.
