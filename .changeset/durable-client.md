---
"@anvia/durable": minor
---

Add `DurableClient`: `await DurableClient.connect({ store })` submits, cancels, responds to, resolves, retries and steers durable runs from a process that holds no agent code and no lease, while `DurableRuntime` workers (`worker: {}`) execute them. A client-submitted run is admitted by the worker that claims it, using that worker's registration. Workers now claim only runs of agents they register, run rows are locked while shared writers read them, and submissions to one session are serialised. A client cannot share a database with an owning runtime. `DurableRunRecord` gains an optional `unadmitted` flag.
