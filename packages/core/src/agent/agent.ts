import { z } from "zod";
import type {
  CompletionModel,
  Document,
  JsonObject,
  JsonValue,
  Message as MessageType,
  ToolChoice,
} from "../completion/index";
import type { AgentObserverRegistration } from "../observability";
import { createTool } from "../tool/create-tool";
import type { ToolSearchDocument } from "../tool/dynamic-tools";
import type { AnyTool, Tool } from "../tool/tool";
import { ToolSet } from "../tool/tool-set";
import type { VectorFilter, VectorSearchIndex, VectorSearchResult } from "../vector-store";
import type { PromptHook } from "./hooks";
import { PromptRequest } from "./request";

export type AgentOptions<M extends CompletionModel = CompletionModel> = {
  id: string;
  name?: string | undefined;
  description?: string | undefined;
  model: M;
  instructions?: string | undefined;
  staticContext?: Document[];
  temperature?: number | undefined;
  maxTokens?: number | undefined;
  additionalParams?: JsonValue | undefined;
  toolSet?: ToolSet | undefined;
  toolChoice?: ToolChoice | undefined;
  defaultMaxTurns?: number | undefined;
  hook?: PromptHook | undefined;
  outputSchema?: JsonObject | undefined;
  observers?: AgentObserverRegistration[] | undefined;
  dynamicContexts?: DynamicContextRegistration[] | undefined;
  dynamicTools?: DynamicToolRegistration[] | undefined;
};

export const DEFAULT_MAX_TURNS = 20;

export type AgentToolOptions = {
  name: string;
  description?: string | undefined;
  maxTurns?: number | undefined;
};

export type DynamicContextOptions<T = unknown> = {
  topK: number;
  threshold?: number | undefined;
  filter?: VectorFilter | undefined;
  format?: ((result: VectorSearchResult<T>) => Document) | undefined;
};

export type DynamicContextRegistration<T = unknown> = {
  index: VectorSearchIndex<T>;
  options: DynamicContextOptions<T>;
};

export type DynamicToolOptions = {
  topK: number;
  threshold?: number | undefined;
  filter?: VectorFilter | undefined;
};

export type DynamicToolRegistration = {
  index: VectorSearchIndex<ToolSearchDocument>;
  options: DynamicToolOptions;
};

export class Agent<M extends CompletionModel = CompletionModel> {
  readonly id: string;
  readonly name: string | undefined;
  readonly description: string | undefined;
  readonly model: M;
  readonly instructions: string | undefined;
  readonly staticContext: Document[];
  readonly temperature: number | undefined;
  readonly maxTokens: number | undefined;
  readonly additionalParams: JsonValue | undefined;
  readonly toolSet: ToolSet;
  readonly toolChoice: ToolChoice | undefined;
  readonly defaultMaxTurns: number | undefined;
  readonly hook: PromptHook | undefined;
  readonly outputSchema: JsonObject | undefined;
  readonly observers: AgentObserverRegistration[];
  readonly dynamicContexts: DynamicContextRegistration[];
  readonly dynamicTools: DynamicToolRegistration[];

  constructor(options: AgentOptions<M>) {
    this.id = normalizeAgentId(options.id);
    this.name = options.name;
    this.description = options.description;
    this.model = options.model;
    this.instructions = options.instructions;
    this.staticContext = options.staticContext ?? [];
    this.temperature = options.temperature;
    this.maxTokens = options.maxTokens;
    this.additionalParams = options.additionalParams;
    this.toolSet = options.toolSet ?? new ToolSet();
    this.toolChoice = options.toolChoice;
    this.defaultMaxTurns = options.defaultMaxTurns ?? DEFAULT_MAX_TURNS;
    this.hook = options.hook;
    this.outputSchema = options.outputSchema;
    this.observers = options.observers ?? [];
    this.dynamicContexts = options.dynamicContexts ?? [];
    this.dynamicTools = options.dynamicTools ?? [];
  }

  prompt(prompt: string | MessageType): PromptRequest<M> {
    return PromptRequest.fromAgent(this, prompt);
  }

  asTool(options: AgentToolOptions): Tool<{ prompt: string }, string> {
    const description =
      options.description ?? this.description ?? `Prompt the ${options.name} agent.`;

    return createTool({
      name: options.name,
      description,
      input: z.object({
        prompt: z.string().describe("The prompt to send to the agent."),
      }),
      output: z.string(),
      execute: async ({ prompt }) => {
        const request = this.prompt(prompt);
        const response =
          options.maxTurns === undefined
            ? await request.send()
            : await request.maxTurns(options.maxTurns).send();
        return response.output;
      },
    });
  }

  getTool(toolName: string): AnyTool | undefined {
    const staticTool = this.toolSet.get(toolName);
    if (staticTool !== undefined) {
      return staticTool;
    }

    for (const registration of this.dynamicTools) {
      const dynamicTool = dynamicToolSetFromIndex(registration.index)?.get(toolName);
      if (dynamicTool !== undefined) {
        return dynamicTool;
      }
    }

    return undefined;
  }

  async callTool(toolName: string, args: string): Promise<string> {
    if (this.toolSet.contains(toolName)) {
      return this.toolSet.call(toolName, args);
    }

    for (const registration of this.dynamicTools) {
      const toolSet = dynamicToolSetFromIndex(registration.index);
      if (toolSet?.contains(toolName)) {
        return toolSet.call(toolName, args);
      }
    }

    return this.toolSet.call(toolName, args);
  }
}

function dynamicToolSetFromIndex(
  index: VectorSearchIndex<ToolSearchDocument>,
): ToolSet | undefined {
  const maybeIndex = index as { toolSet?: unknown };
  return maybeIndex.toolSet instanceof ToolSet ? maybeIndex.toolSet : undefined;
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
