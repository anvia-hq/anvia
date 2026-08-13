import {
  Agent,
  type AgentApprovalDecision,
  type AgentOptions,
  type AgentResult,
  type AgentRunOptions,
  type AgentSession,
  type AgentStream,
  type AgentStreamOptions,
} from "../../src/agent";
import { type ContextIndex, isContextIndex } from "../../src/agent/context-index";
import type { AgentToolInput } from "../../src/agent/types";
import type { CompletionModel, Document, JsonValue, ToolChoice } from "../../src/completion";
import type { GuardrailPolicyInput } from "../../src/guardrails";
import type { AgentHook } from "../../src/hooks";
import { getAgentApprovalRequestDetails } from "../../src/internal/agent-runtime/approval-details";
import type { ToolApprovalRequest } from "../../src/internal/agent-runtime/approval-request";
import { withInternalAgentRunOptions } from "../../src/internal/agent-runtime/run-options";
import type { McpServer } from "../../src/mcp";
import type { MemoryOptions, MemoryStore } from "../../src/memory";
import type { AgentObserver, ObserveOptions } from "../../src/observability";
import type { ZodSchema } from "../../src/schema";
import type { SkillSet } from "../../src/skills";
import type { AgentMiddleware } from "../../src/tool";

type TestApprovalDecision = boolean | AgentApprovalDecision;
type TestApprovalsOptions = {
  handler(request: ToolApprovalRequest): TestApprovalDecision | Promise<TestApprovalDecision>;
};

/** Test-only adapter for exercising internal hook behavior after removing the public builder. */
export class TestAgentBuilder<M extends CompletionModel = CompletionModel> {
  private readonly options: AgentOptions<M>;
  private hookValue: AgentHook | undefined;
  private approvalsValue: TestApprovalsOptions | undefined;
  private staticDocumentCount = 0;

  constructor(id: string, model: M) {
    new Agent({ id, model });
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
    this.options.instructions = [this.options.instructions, instructions]
      .filter(Boolean)
      .join("\n\n");
    return this;
  }

  context(text: string, id?: string): this;
  context(input: Document | ContextIndex): this;
  context(input: string | Document | ContextIndex, id?: string): this {
    const value =
      typeof input === "string"
        ? { id: id ?? `static_doc_${this.staticDocumentCount}`, text: input }
        : input;
    if (typeof input === "string" || !isContextIndex(input)) this.staticDocumentCount += 1;
    this.options.context = [...(this.options.context ?? []), value];
    return this;
  }

  tools(tools: readonly AgentToolInput[]): this {
    this.options.tools = [...(this.options.tools ?? []), ...tools];
    return this;
  }

  mcp(servers: McpServer[]): this {
    this.options.mcpServers = [...(this.options.mcpServers ?? []), ...servers];
    return this;
  }

  skills(skills: SkillSet): this {
    this.options.skills = skills;
    return this;
  }

  temperature(temperature: number): this {
    this.options.temperature = temperature;
    return this;
  }

  maxTokens(maxTokens: number): this {
    this.options.maxTokens = maxTokens;
    return this;
  }

  additionalParams(additionalParams: JsonValue): this {
    this.options.additionalParams = additionalParams;
    return this;
  }

  toolChoice(toolChoice: ToolChoice): this {
    this.options.toolChoice = toolChoice;
    return this;
  }

  defaultMaxTurns(maxTurns: number): this {
    this.options.maxTurns = maxTurns;
    return this;
  }

  hook(hook: AgentHook): this {
    this.hookValue = hook;
    return this;
  }

  approvals(approvals: TestApprovalsOptions): this {
    this.approvalsValue = approvals;
    return this;
  }

  middlewares(middlewares: AgentMiddleware[]): this {
    this.options.middlewares = [...(this.options.middlewares ?? []), ...middlewares];
    return this;
  }

  observe(observer: AgentObserver, options: ObserveOptions = {}): this {
    this.options.observers = [
      ...(this.options.observers ?? []),
      { observer, failOnObserverError: options.failOnObserverError },
    ];
    return this;
  }

  guardrails(guardrails: GuardrailPolicyInput): this {
    this.options.guardrails = guardrails;
    return this;
  }

  memory(store: MemoryStore, options: MemoryOptions = {}): this {
    this.options.memory = { store, ...options };
    new Agent(this.options);
    return this;
  }

  outputSchema(outputSchema: ZodSchema): this {
    this.options.outputSchema = outputSchema;
    return this;
  }

  build(): Agent<M> {
    const agent = new Agent(this.options);
    if (this.hookValue === undefined && this.approvalsValue === undefined) return agent;

    const generate = agent.generate.bind(agent);
    const stream = agent.stream.bind(agent);
    const session = agent.session.bind(agent);
    Object.defineProperty(agent, "generate", {
      value: async (input: Parameters<typeof agent.generate>[0], options: AgentRunOptions = {}) => {
        let result = await generate(input, this.withHook(options));
        while (result.status === "approval_required" && this.approvalsValue !== undefined) {
          const request = getAgentApprovalRequestDetails(result.approval);
          if (request === undefined) throw new Error("Missing internal approval details.");
          const rawDecision = await this.approvalsValue.handler(request);
          const decision: AgentApprovalDecision =
            typeof rawDecision === "boolean" ? { approved: rawDecision } : rawDecision;
          result = await agent.resume(result, decision);
        }
        return result satisfies AgentResult;
      },
    });
    Object.defineProperty(agent, "stream", {
      value: (input: Parameters<typeof agent.stream>[0], options: AgentStreamOptions = {}) =>
        stream(input, this.withHook(options)),
    });
    Object.defineProperty(agent, "session", {
      value: (
        sessionId: Parameters<typeof agent.session>[0],
        options?: Parameters<typeof agent.session>[1],
      ) => this.wrapSession(agent, session(sessionId, options)),
    });
    return agent;
  }

  private withHook<T extends AgentRunOptions>(options: T): T {
    return this.hookValue === undefined
      ? options
      : withInternalAgentRunOptions(options, { hook: this.hookValue });
  }

  private wrapSession(agent: Agent<M>, session: AgentSession<M>): AgentSession<M> {
    if (this.hookValue === undefined && this.approvalsValue === undefined) return session;
    const generate = session.generate.bind(session);
    const stream = session.stream.bind(session);
    Object.defineProperty(session, "generate", {
      value: async (
        input: Parameters<typeof session.generate>[0],
        options: AgentRunOptions = {},
      ) => {
        let result = await generate(input, this.withHook(options));
        while (result.status === "approval_required" && this.approvalsValue !== undefined) {
          const request = getAgentApprovalRequestDetails(result.approval);
          if (request === undefined) throw new Error("Missing internal approval details.");
          const rawDecision = await this.approvalsValue.handler(request);
          const decision: AgentApprovalDecision =
            typeof rawDecision === "boolean" ? { approved: rawDecision } : rawDecision;
          result = await agent.resume(result, decision);
        }
        return result satisfies AgentResult;
      },
    });
    Object.defineProperty(session, "stream", {
      value: (input: Parameters<typeof session.stream>[0], options: AgentStreamOptions = {}) =>
        stream(input, this.withHook(options)) as AgentStream,
    });
    return session;
  }
}
