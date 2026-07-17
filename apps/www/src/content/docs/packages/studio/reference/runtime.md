---
title: "Studio Runtime"
description: "Studio class, server lifecycle, config, and run request contracts."
section: packages
sidebar:
  group: "Reference"
  order: 2
  label: "Studio Runtime"
---
Import from `@anvia/studio`.

## Studio

```ts
class Studio implements AnviaStudio {
  constructor(targets?: StudioTarget[], options?: StudioOptions);
  get app(): Hono;
  fetch(request: Request): Response | Promise<Response>;
  config(): StudioConfig;
  traceObserver(): StudioTraceObserver;
  start(serveOptions?: StudioServeOptions): this;
  serve(serveOptions?: StudioServeLifecycleOptions): Promise<void>;
  close(): void;
}
```

Purpose: local Studio HTTP runtime and UI/API host.

Return behavior: pass built agents, built pipelines, or both in the first array. `start(...)` starts
an HTTP server and returns `this`; `serve(...)` waits for the server to listen, remains active until
Ctrl+C, SIGTERM, or an abort signal, then awaits shutdown cleanup; `fetch(...)` delegates to the
Hono app.

Notable errors: server startup can fail when the port is unavailable; route handlers return structured `StudioErrorResponse` values for request errors.

## AnviaStudio

```ts
type AnviaStudio = {
  readonly app: Hono;
  fetch(request: Request): Response | Promise<Response>;
  config(): StudioConfig;
  close(): void;
};
```

Purpose: minimal Studio runtime interface.

Return behavior: implemented by `Studio`.

Notable errors: none directly.

## Options

```ts
type StudioOptions = {
  quickPrompts?: Record<string, string[]>;
  stores?: StudioStores;
  ui?: boolean | StudioUiOptions;
};

type StudioTarget = Agent | Pipeline<unknown, unknown>;

type StudioServeOptions = {
  port?: number;
  hostname?: string;
  log?: boolean;
  handleSignals?: boolean;
};

type StudioServeLifecycleOptions = Omit<StudioServeOptions, "handleSignals"> & {
  signal?: AbortSignal;
  onShutdown?: () => void | Promise<void>;
};

type StudioUiOptions = {
  path?: string;
  rootRoutes?: boolean;
  title?: string;
  redirectRoot?: boolean;
  clientScript?: string;
  protectShell?: boolean;
};
```

Purpose: configure Studio agents, server binding, and UI mounting.

Return behavior: options are constructor, `start(...)`, or `serve(...)` inputs. Set
`handleSignals: false` when an application using `start(...)` needs to own SIGINT handling. Prefer
`serve(...)` when cleanup is asynchronous: it waits for a successful server bind and invokes
`onShutdown` after closing Studio, including when startup fails.

Notable errors: invalid server options can fail at the Hono server layer.

## Run Contracts

Studio run request, response, and stream event contracts are documented in [Studio Types](/docs/packages/studio/reference/types#run-types).

Purpose: route-level runtime behavior for Studio agent runs.

Return behavior: non-streaming runs return `PromptResponse`; streaming runs emit newline-delimited Studio run events.

Notable errors: invalid request bodies return `StudioErrorResponse` with `bad_request`.
