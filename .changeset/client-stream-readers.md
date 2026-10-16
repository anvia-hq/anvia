---
"@anvia/client": minor
---

Harden the JSONL and SSE stream readers: malformed JSON frames are now skipped and reported through an optional `onParseError` callback (or thrown with `strict: true`) instead of aborting the stream, SSE parsing follows the spec for `event`, `id`, `retry`, multi-line `data`, and comments, and CRLF, LF, and bare CR line endings are handled across chunk boundaries. Adds `readSseFrames` and `EventStreamParseError`, and `onParseError` on fetch and HTTP client transports. Durable client streams stay strict.
