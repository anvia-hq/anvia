import { createRootRoute, createRoute, createRouter, Navigate } from "@tanstack/react-router";
import { StudioConsoleLayout } from "./modules/shell/studio-console-layout";
import { AgentsRoute } from "./routes/agents-route";
import { EvalsRoute } from "./routes/evals-route";
import { KnowledgeRoute } from "./routes/knowledge-route";
import { McpsRoute } from "./routes/mcps-route";
import { MemoryRoute } from "./routes/memory-route";
import { PipelinesRoute } from "./routes/pipelines-route";
import { PlaygroundRoute } from "./routes/playground-route";
import { SandboxesRoute } from "./routes/sandboxes-route";
import { SessionsRoute } from "./routes/sessions-route";
import { StatusRoute } from "./routes/status-route";
import { ToolsRoute } from "./routes/tools-route";
import { TracingRoute } from "./routes/tracing-route";

const rootRoute = createRootRoute({
  component: StudioConsoleLayout,
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: () => <Navigate to="/playground" replace />,
});

const playgroundRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "playground",
  component: PlaygroundRoute,
});

const playgroundSessionRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "playground/$sessionId",
  component: PlaygroundRoute,
});

const tracingRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "tracing",
  component: TracingRoute,
});

const tracingTraceRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "tracing/$traceId",
  component: TracingRoute,
});

const tracingSessionRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "tracing/sessions/$sessionId",
  component: TracingRoute,
});

const sessionsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "sessions",
  component: SessionsRoute,
});

const agentsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "agents",
  component: AgentsRoute,
});

const toolsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "tools",
  component: ToolsRoute,
});

const sandboxesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "sandboxes",
  component: SandboxesRoute,
});

const sandboxDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "sandboxes/$sandboxRef",
  component: SandboxesRoute,
});

const mcpsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "mcps",
  component: McpsRoute,
});

const pipelinesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "pipelines",
  component: PipelinesRoute,
});

const evalsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "evals",
  component: EvalsRoute,
});

const knowledgeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "knowledge",
  component: KnowledgeRoute,
});

const knowledgeTabRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "knowledge/$tab",
  component: KnowledgeRoute,
});

const memoryRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "memory",
  component: MemoryRoute,
});

const statusRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "status",
  component: StatusRoute,
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  playgroundRoute,
  playgroundSessionRoute,
  tracingRoute,
  tracingTraceRoute,
  tracingSessionRoute,
  sessionsRoute,
  agentsRoute,
  toolsRoute,
  sandboxesRoute,
  sandboxDetailRoute,
  mcpsRoute,
  pipelinesRoute,
  evalsRoute,
  knowledgeRoute,
  knowledgeTabRoute,
  memoryRoute,
  statusRoute,
]);

export const studioRouter = createRouter({
  routeTree,
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof studioRouter;
  }
}
