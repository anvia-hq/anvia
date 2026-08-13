import {
  type CompletionModel,
  type Document,
  isProviderTool,
  type JsonObject,
  type JsonValue,
  type ProviderTool,
  type ToolChoice,
} from "../completion";
import type { GuardrailPolicy, GuardrailPolicyInput } from "../guardrails";
import { appendGuardrailPolicies } from "../guardrails";
import type { AgentHook } from "../hooks";
import type { McpServer } from "../mcp";
import { resolveMemoryOptions } from "../memory/options";
import type { MemoryOptions, MemoryRegistration, MemoryStore } from "../memory/types";
import type { AgentObserver, AgentObserverRegistration, ObserveOptions } from "../observability";
import { toProviderJsonSchema, type ZodSchema } from "../schema/zod-schema";
import type { SkillSet } from "../skills";
import { isToolIndex, type ToolIndex } from "../tool/dynamic-tools";
import type { AgentMiddleware } from "../tool/middleware";
import type { AnyTool, ToolApprovalsOptions } from "../tool/tool";
import type { VectorSearchIndex } from "../vector-store";
import { type Agent, createResolvedAgent } from "./agent";
import { normalizeAgentId } from "./ids";
import type { AgentToolInput, DynamicContextOptions, DynamicContextRegistration } from "./types";

export class AgentBuilder<M extends CompletionModel = CompletionModel> {
  private readonly agentId: string;
  private agentName: string | undefined;
  private agentDescription: string | undefined;
  private instructionBlocks: string[] = [];
  private contextDocs: Document[] = [];
  private temp: number | undefined;
  private maxTokenCount: number | undefined;
  private params: JsonValue | undefined;
  private choice: ToolChoice | undefined;
  private turns: number | undefined;
  private agentHook: AgentHook | undefined;
  private schema: JsonObject | undefined;
  private approvalOptions: ToolApprovalsOptions | undefined;
  private guardrailPolicies: GuardrailPolicy[] = [];
  private skillInstructionBlocks: string[] = [];
  private observerRegistrations: AgentObserverRegistration[] = [];
  private dynamicContextRegistrations: DynamicContextRegistration[] = [];
  private middlewareRegistrations: AgentMiddleware[] = [];
  private memoryRegistration: MemoryRegistration | undefined;
  private activeTools = new Map<string, AnyTool>();
  private providerToolDefs: ProviderTool[] = [];
  private toolIndexes: ToolIndex[] = [];

  constructor(
    agentId: string,
    private readonly completionModel: M,
  ) {
    this.agentId = normalizeAgentId(agentId);
  }

  name(name: string): this {
    this.agentName = name;
    return this;
  }

  description(description: string): this {
    this.agentDescription = description;
    return this;
  }

  instructions(instructions: string): this {
    if (instructions.length > 0) {
      this.instructionBlocks.push(instructions);
    }
    return this;
  }

  context(text: string, id = `static_doc_${this.contextDocs.length}`): this {
    this.contextDocs.push({ id, text });
    return this;
  }

  dynamicContext<T>(index: VectorSearchIndex<T>, options: DynamicContextOptions<T>): this {
    this.dynamicContextRegistrations.push({ index, options } as DynamicContextRegistration);
    return this;
  }

  tools(tools: readonly AgentToolInput[]): this {
    for (const tool of tools) {
      if (isProviderTool(tool)) {
        this.providerToolDefs.push(tool);
      } else if (isToolIndex(tool)) {
        this.toolIndexes.push(tool);
      } else {
        this.activeTools.set(tool.name, tool);
      }
    }
    return this;
  }

  mcp(servers: McpServer[]): this {
    for (const server of servers) {
      for (const tool of server.tools) {
        this.activeTools.set(tool.name, tool);
      }
    }
    return this;
  }

  skills(skillSet: SkillSet): this {
    if (skillSet.instructions.length > 0) {
      this.skillInstructionBlocks.push(skillSet.instructions);
    }
    for (const tool of skillSet.tools) {
      this.activeTools.set(tool.name, tool);
    }
    return this;
  }

  temperature(temperature: number): this {
    this.temp = temperature;
    return this;
  }

  maxTokens(maxTokens: number): this {
    this.maxTokenCount = maxTokens;
    return this;
  }

  additionalParams(params: JsonValue): this {
    this.params = params;
    return this;
  }

  toolChoice(toolChoice: ToolChoice): this {
    this.choice = toolChoice;
    return this;
  }

  defaultMaxTurns(defaultMaxTurns: number): this {
    this.turns = defaultMaxTurns;
    return this;
  }

  hook(hook: AgentHook): this {
    this.agentHook = hook;
    return this;
  }

  middlewares(middlewares: AgentMiddleware[]): this {
    this.middlewareRegistrations.push(...middlewares);
    return this;
  }

  observe(observer: AgentObserver, options: ObserveOptions = {}): this {
    this.observerRegistrations.push({
      observer,
      failOnObserverError: options.failOnObserverError,
    });
    return this;
  }

  approvals(options: ToolApprovalsOptions): this {
    this.approvalOptions = options;
    return this;
  }

  guardrails(policies: GuardrailPolicyInput): this {
    this.guardrailPolicies = appendGuardrailPolicies(this.guardrailPolicies, policies);
    return this;
  }

  memory(store: MemoryStore, options: MemoryOptions = {}): this {
    const resolvedOptions = resolveMemoryOptions(options);
    if (resolvedOptions.compaction !== undefined && store.compaction === undefined) {
      throw new TypeError(
        "Memory compaction requires a store with the optional compaction capability.",
      );
    }
    this.memoryRegistration = {
      store,
      options: resolvedOptions,
    };
    return this;
  }

  outputSchema(schema: ZodSchema): this {
    this.schema = toProviderJsonSchema(schema);
    return this;
  }

  build(): Agent<M> {
    return createResolvedAgent({
      id: this.agentId,
      name: this.agentName,
      description: this.agentDescription,
      model: this.completionModel,
      instructions: this.buildInstructions(),
      staticContext: this.contextDocs,
      temperature: this.temp,
      maxTokens: this.maxTokenCount,
      additionalParams: this.params,
      tools: [...this.activeTools.values()],
      providerTools: this.providerToolDefs,
      toolIndexes: this.toolIndexes,
      toolChoice: this.choice,
      defaultMaxTurns: this.turns,
      hook: this.agentHook,
      outputSchema: this.schema,
      observers: this.observerRegistrations,
      approvals: this.approvalOptions,
      guardrails: this.guardrailPolicies,
      dynamicContexts: this.dynamicContextRegistrations,
      middlewares: this.middlewareRegistrations,
      memory: this.memoryRegistration,
    });
  }

  private buildInstructions(): string | undefined {
    const parts = [...this.instructionBlocks, ...this.skillInstructionBlocks].filter(
      (part): part is string => part !== undefined && part.length > 0,
    );
    return parts.length === 0 ? undefined : parts.join("\n\n");
  }
}
