import type { CompletionModel, Document, JsonObject, JsonValue, ToolChoice } from "../completion";
import type { McpServer } from "../mcp";
import type { AgentObserver, AgentObserverRegistration, ObserveOptions } from "../observability";
import { toProviderJsonSchema, type ZodSchema } from "../schema/zod-schema";
import type { SkillSet } from "../skills";
import type { ToolSearchDocument } from "../tool/dynamic-tools";
import type { AnyTool } from "../tool/tool";
import { ToolSet } from "../tool/tool-set";
import type { VectorSearchIndex } from "../vector-store";
import {
  Agent,
  type DynamicContextOptions,
  type DynamicContextRegistration,
  type DynamicToolOptions,
  type DynamicToolRegistration,
} from "./agent";
import type { PromptHook } from "./hooks";

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
  private requestHook: PromptHook | undefined;
  private schema: JsonObject | undefined;
  private skillInstructionBlocks: string[] = [];
  private observerRegistrations: AgentObserverRegistration[] = [];
  private dynamicContextRegistrations: DynamicContextRegistration[] = [];
  private dynamicToolRegistrations: DynamicToolRegistration[] = [];
  private activeToolSet = new ToolSet();

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

  dynamicTools(index: VectorSearchIndex<ToolSearchDocument>, options: DynamicToolOptions): this {
    this.dynamicToolRegistrations.push({ index, options });
    return this;
  }

  tool(tool: AnyTool): this {
    this.activeToolSet.addTool(tool);
    return this;
  }

  tools(tools: AnyTool[]): this {
    this.activeToolSet.addTools(tools);
    return this;
  }

  mcp(servers: McpServer[]): this {
    for (const server of servers) {
      this.activeToolSet.addTools(server.tools);
    }
    return this;
  }

  skills(skillSet: SkillSet): this {
    if (skillSet.instructions.length > 0) {
      this.skillInstructionBlocks.push(skillSet.instructions);
    }
    this.activeToolSet.addTools(skillSet.tools);
    return this;
  }

  useToolSet(toolSet: ToolSet): this {
    toolSet.addTools(this.activeToolSet);
    this.activeToolSet = toolSet;
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

  hook(hook: PromptHook): this {
    this.requestHook = hook;
    return this;
  }

  observe(observer: AgentObserver, options: ObserveOptions = {}): this {
    this.observerRegistrations.push({
      observer,
      failOnObserverError: options.failOnObserverError,
    });
    return this;
  }

  outputSchema(schema: ZodSchema): this {
    this.schema = toProviderJsonSchema(schema);
    return this;
  }

  build(): Agent<M> {
    return new Agent({
      id: this.agentId,
      name: this.agentName,
      description: this.agentDescription,
      model: this.completionModel,
      instructions: this.buildInstructions(),
      staticContext: this.contextDocs,
      temperature: this.temp,
      maxTokens: this.maxTokenCount,
      additionalParams: this.params,
      toolSet: this.activeToolSet,
      toolChoice: this.choice,
      defaultMaxTurns: this.turns,
      hook: this.requestHook,
      outputSchema: this.schema,
      observers: this.observerRegistrations,
      dynamicContexts: this.dynamicContextRegistrations,
      dynamicTools: this.dynamicToolRegistrations,
    });
  }

  private buildInstructions(): string | undefined {
    const parts = [...this.instructionBlocks, ...this.skillInstructionBlocks].filter(
      (part): part is string => part !== undefined && part.length > 0,
    );
    return parts.length === 0 ? undefined : parts.join("\n\n");
  }
}

function normalizeAgentId(id: string): string {
  if (typeof id !== "string") {
    throw new TypeError("Agent id must be a string.");
  }

  const normalized = id.trim();
  if (normalized.length === 0) {
    throw new TypeError("Agent id must be a non-empty string.");
  }

  return normalized;
}
