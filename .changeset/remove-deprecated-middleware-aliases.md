---
"@anvia/core": minor
---

**Breaking:** Remove deprecated middleware and hook aliases.

Use `createMiddleware`, `AgentMiddleware`, `.middleware(...)` / `.middlewares(...)`, `.withMiddleware(...)` / `.withMiddlewares(...)`, `.withHook(...)`, and `onToolOutput` instead of `createToolMiddleware`, `ToolMiddleware`, `.toolMiddleware(...)` / `.toolMiddlewares(...)`, `.withToolMiddleware(...)` / `.withToolMiddlewares(...)`, `.requestHook(...)`, and `onResult`.
