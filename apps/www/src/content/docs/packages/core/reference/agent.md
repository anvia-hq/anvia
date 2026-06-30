---
title: "Agent"
description: "Agent construction, built-agent behavior, dynamic context, and event-store contracts."
section: packages
sidebar:
  group: "Reference"
  order: 2
  label: "Agent"
---
Import from `@anvia/core/agent` when a module specifically builds or configures agents. Use `@anvia/core` for application code that wants one convenient authoring import.

`@anvia/core/agent` is intentionally narrow. Prompt lifecycle hooks live in [`@anvia/core/hooks`](/docs/packages/core/reference/hooks). Prompt requests, stream events, responses, and prompt errors live in [`@anvia/core/request`](/docs/packages/core/reference/request). Tool approvals and middleware live in [`@anvia/core/tool`](/docs/packages/core/reference/tools).

## AgentBuilder

```ts
class AgentBuilder<M extends CompletionModel = CompletionModel> {
  constructor(agentId: string, completionModel: M);
  name(name: string): this;
  description(description: string): this;
  instructions(instructions: string): this;
  context(text: string, id?: string): this;
  dynamicContext<T>(index: VectorSearchIndex<T>, options: DynamicContextOptions<T>): this;
  dynamicTools(index: VectorSearchIndex<ToolSearchDocument>, options: DynamicToolOptions): this;
  tool(tool: Tool): this;
  tools(tools: Tool[]): this;
  useToolSet(toolSet: ToolSet): this;
  mcp(servers: McpServer[]): this;
  skills(skillSet: SkillSet): this;
  temperature(temperature: number): this;
  maxTokens(maxTokens: number): this;
  additionalParams(params: JsonValue): this;
  toolChoice(toolChoice: ToolChoice): this;
  defaultMaxTurns(defaultMaxTurns: number): this;
  hook(hook: PromptHook): this;
  middleware(middleware: AgentMiddleware): this;
  middlewares(middlewares: AgentMiddleware[]): this;
  /** @deprecated Use middleware instead. */
  toolMiddleware(middleware: ToolMiddleware): this;
  /** @deprecated Use middlewares instead. */
  toolMiddlewares(middlewares: ToolMiddleware[]): this;
  observe(observer: AgentObserver, options?: ObserveOptions): this;
  approvals(options: ToolApprovalsOptions): this;
  memory(store: MemoryStore, options?: MemoryOptions): this;
  eventStore(store: AgentEventStore, options?: AgentEventStoreOptions): this;
  outputSchema(schema: ZodSchema): this;
  build(): Agent<M>;
}
```

Purpose: fluent builder for immutable runnable agent configuration.

Return behavior: mutator methods return `this`; `build()` returns a built agent object. `Agent` is exported as a type for annotations, but the runtime constructor is internal.

Notable errors: the constructor rejects an empty agent id. `outputSchema(...)` can throw if the schema cannot be converted to provider JSON schema.

## Built Agent

```ts
type Agent<M extends CompletionModel = CompletionModel> = {
  readonly id: string;
  readonly name?: string;
  readonly description?: string;
  prompt(prompt: string | Message | Message[]): PromptRequest<M>;
  session(sessionId: string, options?: SessionOptions): AgentSession<M>;
  asTool(options: AgentToolOptions): Tool<{ prompt: string }, string>;
  getTool(toolName: string): Tool | undefined;
  callTool(toolName: string, args: string, context?: ToolCallContext): Promise<string>;
};
```

Purpose: runnable agent returned by `AgentBuilder.build()`.

Return behavior: `prompt(...)` creates a per-run prompt request; `session(...)` creates a durable memory-backed conversation scope; `asTool(...)` exposes the agent as a tool and can forward child-agent stream events when `stream: true`.

Notable errors: `session(...)` throws when no memory store is configured or the session id is empty. Prompt-run errors are documented in [`Request`](/docs/packages/core/reference/request).

## AgentSession

```ts
type AgentSession<M extends CompletionModel = CompletionModel> = {
  prompt(prompt: string | Message): PromptRequest<M>;
  messages(): Promise<Message[]>;
  clear(): Promise<void>;
};
```

Purpose: durable conversation scope created by `agent.session(sessionId, options?)`.

Return behavior: `prompt(...)` loads messages from the configured memory store before the run and appends new messages according to the agent memory policy. Session prompts do not accept `Message[]`; use `agent.prompt(Message[])` for explicit stateless transcripts.

Notable errors: methods throw when the built agent has no memory store configured.

## AgentEventStore

```ts
interface AgentEventStore {
  append(input: AgentEventAppendInput): Promise<void>;
  load(runId: string): Promise<AgentEventRecord[]>;
  clear?(runId: string): Promise<void>;
}

type AgentEventStoreInclude = "all" | "agent_tool_events";

type AgentEventStoreOptions = {
  include?: AgentEventStoreInclude;
};

type AgentEventAppendInput = {
  runId: string;
  agentId: string;
  agentName?: string;
  turn?: number;
  toolName?: string;
  toolCallId?: string;
  internalCallId?: string;
  event: unknown;
};

type AgentEventRecord = AgentEventAppendInput & {
  createdAt?: Date;
};
```

Purpose: persist agent stream events for replay, debugging, or local inspection.

Return behavior: `include: "all"` stores parent and child stream events. `include: "agent_tool_events"` stores only nested child-agent events from streaming agent tools.

## Dynamic Context And Tools

```ts
type DynamicContextOptions<T = unknown> = {
  topK: number;
  threshold?: number;
  filter?: VectorFilter;
  format?: (result: VectorSearchResult<T>) => Document;
};

type DynamicToolOptions = {
  topK: number;
  threshold?: number;
  filter?: VectorFilter;
};

type AgentToolOptions = {
  name: string;
  description?: string;
  maxTurns?: number;
  stream?: boolean;
};
```

Purpose: configure retrieval-backed context, retrieval-backed tool definitions, and agent-as-tool behavior.

Return behavior: dynamic context documents and dynamic tool definitions are resolved before each model turn. `AgentToolOptions.stream` controls whether nested child-agent events are forwarded to the parent run.

For prompt request methods, stream events, and run errors, see [`Request`](/docs/packages/core/reference/request). For hook contracts, see [`Hooks`](/docs/packages/core/reference/hooks).
