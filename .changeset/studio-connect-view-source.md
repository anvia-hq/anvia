---
"@anvia/studio": patch
---

A sandbox desktop view can now open its own connection instead of naming a published Docker port. A view source is either `{ containerPort }` as before or `{ connect() }`, which returns a byte stream (the shape of a tunnel handle), so a desktop reached through a tunnel can be shown in the Playground. The view's `control` may now be asynchronous: `snapshot`, `lease.renew` and `lease.release` can return promises. A `connect` view no longer needs the inspector to publish ports.
