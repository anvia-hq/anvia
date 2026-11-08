---
"@anvia/server": patch
"@anvia/client": patch
---

Declare the optional `@anvia/durable` peer as `>=0.8.0 <1.0.0` instead of a list of caret ranges, so each durable minor release no longer needs a peer-range edit.
