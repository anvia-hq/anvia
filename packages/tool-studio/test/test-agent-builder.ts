import type { AgentToolInput, ContextIndex } from "@anvia/core/agent";
import { Agent, type AgentOptions } from "@anvia/core/agent";
import type { CompletionModel, Document } from "@anvia/core/completion";
import type { McpServer } from "@anvia/core/mcp";
import type { MemoryOptions, MemoryStore } from "@anvia/core/memory";
import type { AgentObserver, ObserveOptions } from "@anvia/core/observability";

/** Test fixture adapter; production code uses new Agent(options) directly. */
export class TestAgentBuilder<M extends CompletionModel = CompletionModel> {
  private readonly options: AgentOptions<M>;
  private staticDocumentCount = 0;

  constructor(id: string, model: M) {
    this.options = { id, model };
  }

  name(name: string): this {
    this.options.name = name;
    return this;
  }

  description(description: string): this {
    this.options.description = description;
    return this;
  }

  instructions(instructions: string): this {
    this.options.instructions = instructions;
    return this;
  }

  context(text: string, id?: string): this;
  context(input: Document | ContextIndex): this;
  context(input: string | Document | ContextIndex, id?: string): this {
    const value =
      typeof input === "string"
        ? { id: id ?? `static_doc_${this.staticDocumentCount}`, text: input }
        : input;
    this.staticDocumentCount += 1;
    this.options.context = [...(this.options.context ?? []), value];
    return this;
  }

  tools(tools: readonly AgentToolInput[]): this {
    this.options.tools = [...(this.options.tools ?? []), ...tools];
    return this;
  }

  mcp(mcpServers: McpServer[]): this {
    this.options.mcpServers = mcpServers;
    return this;
  }

  defaultMaxTurns(maxTurns: number): this {
    this.options.maxTurns = maxTurns;
    return this;
  }

  observe(observer: AgentObserver, options: ObserveOptions = {}): this {
    this.options.observers = [
      ...(this.options.observers ?? []),
      { observer, failOnObserverError: options.failOnObserverError },
    ];
    return this;
  }

  memory(store: MemoryStore, options: MemoryOptions = {}): this {
    this.options.memory = { store, ...options };
    return this;
  }

  build(): Agent<M> {
    return new Agent(this.options);
  }
}
