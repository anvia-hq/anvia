---
"@anvia/otel": minor
---

Include request instructions in top-level and streamed child-agent generation inputs. Full-capture
`anvia.generation.input` payloads now use `{ instructions, messages }`; input transforms receive the
same structured object. Safe capture continues to omit the payload.
