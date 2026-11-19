---
"@anvia/durable": minor
---

Graphs now work with shared workers and `DurableClient`: `submitGraph`, `getGraph`, `listGraphs`, `graphSnapshot` and `cancelGraph` are available in worker mode and on the client. Graph tasks for agents the submitter does not register are stored unadmitted and admitted by the worker that runs them, which fails a task whose agent records memory. Custom tasks and goals remain owner-only.
