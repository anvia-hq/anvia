---
"@anvia/studio": minor
---

Bound JSON request bodies. Studio now rejects a body above `maxBodyBytes` with a `413` `payload_too_large` response instead of reading it into memory and persisting it. The limit defaults to 10 MiB and can be set through `StudioOptions.maxBodyBytes` or `StudioServeOptions.maxBodyBytes`.
