import { isStreamingCompletionModel } from "../completion/generate-completion";
import type { CompletionModel, JsonObject, ToolChoice } from "../completion/index";
import type { GuardrailPolicy } from "../guardrails";
import { AgentRun } from "../internal/agent-runtime/agent-run";
import { prepareToolCall } from "../internal/agent-runtime/prepared-tool-call";
import { assertNonnegativeSafeInteger } from "../internal/agent-runtime/run-validation";
import type { McpServer } from "../mcp";
import type { AgentObservabilityOptions } from "../observability";
import type { RetrySetting } from "../retry";
import type { ZodSchema } from "../schema/zod-schema";
import { ToolNotFoundError } from "../tool/errors";
import type { AgentMiddleware } from "../tool/middleware";
import type { AnyTool, NormalizedToolOutput, Tool, ToolCallContext } from "../tool/tool";
import { createAgentStream } from "./agent-stream";
import { createAgentTool } from "./agent-tool";
import { normalizeAgentId } from "./ids";
import type { AgentLifecycle } from "./lifecycle";
import { registerAgentProviderOutputSchema } from "./output-schema";
import { resolveAgentOptions } from "./resolve-options";
import type { AgentResult, AgentRunOptions, AgentStream, AgentStreamEvent } from "./run-types";
import {
  cloneFrozenPlainData,
  snapshotAgentContext,
  snapshotAgentMemory,
  snapshotAgentObservability,
  snapshotGuardrailPolicies,
} from "./snapshot";
import { prepareAgentTools } from "./tool-catalog";
import { getRegisteredAgentTool, registerAgentToolState } from "./tool-state";
import type { AgentContextInput, AgentMemory, AgentOptions, AgentToolOptions } from "./types";

const DEFAULT_MAX_TURNS = 20;

type RawResponseOf<Model> =
  Model extends CompletionModel<infer RawResponse> ? RawResponse : unknown;

export class Agent<
  Output = string,
  M extends CompletionModel = CompletionModel,
  ContextDocument = unknown,
> {
  readonly id: string;
  readonly name: string | undefined;
  readonly description: string | undefined;
  readonly model: M;
  readonly instructions: string | undefined;
  readonly context: readonly AgentContextInput<ContextDocument>[];
  readonly temperature: number | undefined;
  readonly maxTokens: number | undefined;
  readonly providerOptions: JsonObject | undefined;
  readonly retries: RetrySetting | undefined;
  readonly mcpServers: readonly McpServer[];
  readonly tools: readonly AnyTool[];
  readonly toolChoice: ToolChoice | undefined;
  readonly defaultMaxTurns: number | undefined;
  readonly lifecycle: AgentLifecycle<Output, RawResponseOf<M>> | undefined;
  readonly outputSchema: ZodSchema<Output> | undefined;
  readonly observability: AgentObservabilityOptions | undefined;
  readonly guardrails: readonly GuardrailPolicy[];
  readonly middlewares: readonly AgentMiddleware[];
  readonly memory: AgentMemory | undefined;

  constructor(options: AgentOptions<Output, M, ContextDocument>) {
    const resolved = resolveAgentOptions(options);
    this.id = normalizeAgentId(resolved.id);
    this.name = resolved.name;
    this.description = resolved.description;
    this.model = resolved.model;
    this.instructions = resolved.instructions;
    this.context = snapshotAgentContext(resolved.context);
    this.temperature = resolved.temperature;
    this.maxTokens = resolved.maxTokens;
    this.providerOptions = cloneFrozenPlainData(resolved.providerOptions);
    this.retries = cloneFrozenPlainData(resolved.retries);

    const preparedTools = prepareAgentTools(resolved);
    this.mcpServers = preparedTools.mcpServers;
    this.tools = preparedTools.tools;
    registerAgentToolState(this, preparedTools.publicState, preparedTools.toolsByName);

    this.toolChoice = cloneFrozenPlainData(resolved.toolChoice);
    this.defaultMaxTurns = assertNonnegativeSafeInteger(
      resolved.defaultMaxTurns ?? DEFAULT_MAX_TURNS,
      "maxTurns",
    );
    this.lifecycle = resolved.lifecycle;
    this.outputSchema = resolved.outputSchema;
    registerAgentProviderOutputSchema(this, resolved.outputSchema);
    this.observability = snapshotAgentObservability(resolved.observability);
    this.guardrails = snapshotGuardrailPolicies(resolved.guardrails);
    this.middlewares = Object.freeze([...(resolved.middlewares ?? [])]);
    this.memory = snapshotAgentMemory(resolved.memory);
  }

  generate(options: AgentRunOptions<Output, RawResponseOf<M>>): Promise<AgentResult<Output>> {
    return AgentRun.fromAgent(this, options).generate();
  }

  stream(
    options: AgentRunOptions<Output, RawResponseOf<M>>,
  ): AgentStream<AgentStreamEvent<Output, RawResponseOf<M>>> {
    const run = AgentRun.fromAgent(this, options);
    if (!this.model.capabilities.streaming || !isStreamingCompletionModel(this.model)) {
      throw new Error("This completion model does not support streaming");
    }
    return createAgentStream(run);
  }

  asTool(options: AgentToolOptions): Tool<{ prompt: string }, Output> {
    return createAgentTool(this, options);
  }

  getTool(toolName: string): AnyTool | undefined {
    return getRegisteredAgentTool(this, toolName);
  }

  async callTool(
    toolName: string,
    args: string,
    context?: ToolCallContext,
  ): Promise<NormalizedToolOutput> {
    const tool = this.getTool(toolName);
    if (tool === undefined) {
      throw new ToolNotFoundError(toolName);
    }
    return prepareToolCall(tool, args).call(context ?? {});
  }
}
