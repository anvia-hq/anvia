---
"@anvia/memgraph": patch
---

Reject NUL bytes in identifiers. `quoteIdentifier` now throws for a name containing `\u0000`, matching `@anvia/neo4j`, so a schema or resource name cannot smuggle a control character into generated Cypher.
