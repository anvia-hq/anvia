---
"@anvia/core": minor
---

Add `searchTool()`: one tool that searches its own domain, returned as a `ToolIndex` so it registers through `Agent.tools` unchanged.

A flat tool index ranks a generic tool like `search_runbooks` by its own name and description, so a query about a deployment checklist never reaches it. `searchTool` embeds the _entries_ instead and returns their text and detail, so the model finds the runbook and reads the steps. Without a `model` it matches terms case-insensitively over the same text, which covers a few dozen entries with no embedding provider.

The tool answers a call from the search the agent just ran for that turn; `format` renders the hits, and a miss returns "No matching entries." rather than an empty prompt.
