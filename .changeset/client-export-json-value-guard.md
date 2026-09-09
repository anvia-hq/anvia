---
"@anvia/client": minor
---

Export the `isJsonValue` JSON-safety guard from the package entrypoint so server
and application stream serializers can validate payloads with the same rules the
client protocol uses.
