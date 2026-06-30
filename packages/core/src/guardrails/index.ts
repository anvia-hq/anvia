import type { JsonObject, JsonValue, Message, ToolResultContent, Usage } from "../completion";

type MaybePromise<T> = T | Promise<T>;

export type GuardrailMode = "enforce" | "observe";

export type GuardrailBoundary = "input" | "tool" | "tool_result" | "output";

export type GuardrailRunContext = {
  agentId: string;
  runId: string;
  sessionId?: string | undefined;
  metadata?: JsonObject | undefined;
};

export type GuardrailDecisionRecord = {
  policyId: string;
  guardrailId: string;
  boundary: GuardrailBoundary;
  mode: GuardrailMode;
  action: GuardrailActionName;
  applied: boolean;
  reason?: string | undefined;
  message?: string | undefined;
  metadata?: JsonObject | undefined;
  latencyMs: number;
};

export type GuardrailActionName = "allow" | "block" | "rewrite" | "request_approval" | "error";

export type GuardrailActionBase = {
  reason?: string | undefined;
  metadata?: JsonObject | undefined;
};

export type GuardrailAllow = GuardrailActionBase & {
  action: "allow";
};

export type GuardrailBlock = GuardrailActionBase & {
  action: "block";
  reason: string;
  message?: string | undefined;
};

export type InputGuardrailRewrite = GuardrailActionBase & {
  action: "rewrite";
  prompt?: Message | undefined;
  inputText?: string | undefined;
};

export type ToolGuardrailRewrite = GuardrailActionBase & {
  action: "rewrite";
  args: JsonValue | string;
};

export type ToolResultGuardrailRewrite = GuardrailActionBase & {
  action: "rewrite";
  result?: string | undefined;
  structuredResult?: ToolResultContent[] | undefined;
};

export type OutputGuardrailRewrite = GuardrailActionBase & {
  action: "rewrite";
  outputText: string;
};

export type ToolGuardrailApprovalRequest = GuardrailActionBase & {
  action: "request_approval";
  reason?: string | undefined;
  rejectMessage?: string | undefined;
};

export type InputGuardrailResult = GuardrailAllow | GuardrailBlock | InputGuardrailRewrite;
export type ToolGuardrailResult =
  | GuardrailAllow
  | GuardrailBlock
  | ToolGuardrailRewrite
  | ToolGuardrailApprovalRequest;
export type ToolResultGuardrailResult =
  | GuardrailAllow
  | GuardrailBlock
  | ToolResultGuardrailRewrite;
export type OutputGuardrailResult = GuardrailAllow | GuardrailBlock | OutputGuardrailRewrite;

export type GuardrailCommonActions = {
  allow(options?: GuardrailActionBase): GuardrailAllow;
  block(options: Omit<GuardrailBlock, "action">): GuardrailBlock;
};

export type InputGuardrailActions = GuardrailCommonActions & {
  rewrite(options: Omit<InputGuardrailRewrite, "action">): InputGuardrailRewrite;
};

export type ToolGuardrailActions = GuardrailCommonActions & {
  rewrite(options: Omit<ToolGuardrailRewrite, "action">): ToolGuardrailRewrite;
  requestApproval(
    options?: Omit<ToolGuardrailApprovalRequest, "action">,
  ): ToolGuardrailApprovalRequest;
};

export type ToolResultGuardrailActions = GuardrailCommonActions & {
  rewrite(options: Omit<ToolResultGuardrailRewrite, "action">): ToolResultGuardrailRewrite;
};

export type OutputGuardrailActions = GuardrailCommonActions & {
  rewrite(options: Omit<OutputGuardrailRewrite, "action">): OutputGuardrailRewrite;
};

export type InputGuardrailContext = {
  prompt: Message;
  history: Message[];
  inputText: string;
  run: GuardrailRunContext;
};

export type ToolGuardrailContext<Args = unknown> = {
  toolName: string;
  args: Args;
  rawArgs: string;
  toolCallId?: string | undefined;
  internalCallId: string;
  turn: number;
  run: GuardrailRunContext;
};

export type ToolResultGuardrailContext<Args = unknown> = {
  toolName: string;
  args: Args;
  rawArgs: string;
  result: string;
  structuredResult?: ToolResultContent[] | undefined;
  toolCallId?: string | undefined;
  internalCallId: string;
  turn: number;
  run: GuardrailRunContext;
};

export type OutputGuardrailContext = {
  outputText: string;
  messages: Message[];
  usage: Usage;
  run: GuardrailRunContext;
};

export type InputGuardrail = {
  id: string;
  check(
    context: InputGuardrailContext,
    actions: InputGuardrailActions,
  ): MaybePromise<InputGuardrailResult | undefined>;
};

export type ToolGuardrail<Args = unknown> = {
  id: string;
  tool?: string | string[] | undefined;
  check(
    context: ToolGuardrailContext<Args>,
    actions: ToolGuardrailActions,
  ): MaybePromise<ToolGuardrailResult | undefined>;
};

export type ToolResultGuardrail<Args = unknown> = {
  id: string;
  tool?: string | string[] | undefined;
  check(
    context: ToolResultGuardrailContext<Args>,
    actions: ToolResultGuardrailActions,
  ): MaybePromise<ToolResultGuardrailResult | undefined>;
};

export type OutputGuardrail = {
  id: string;
  check(
    context: OutputGuardrailContext,
    actions: OutputGuardrailActions,
  ): MaybePromise<OutputGuardrailResult | undefined>;
};

export type GuardrailPolicy = {
  id: string;
  mode: GuardrailMode;
  input: InputGuardrail[];
  tools: ToolGuardrail[];
  toolResults: ToolResultGuardrail[];
  output: OutputGuardrail[];
};

export type GuardrailPolicyOptions = {
  id: string;
  mode?: GuardrailMode | undefined;
  input?: InputGuardrail[] | undefined;
  tools?: ToolGuardrail[] | undefined;
  toolResults?: ToolResultGuardrail[] | undefined;
  output?: OutputGuardrail[] | undefined;
};

export type GuardrailPolicyInput = GuardrailPolicy | GuardrailPolicy[];

export type InputGuardrailRunResult = {
  prompt: Message;
  inputText: string;
  blocked: boolean;
  message?: string | undefined;
  decisions: GuardrailDecisionRecord[];
};

export type ToolGuardrailRunResult = {
  rawArgs: string;
  blocked: boolean;
  message?: string | undefined;
  approval?: { reason?: string | undefined; rejectMessage?: string | undefined } | undefined;
  decisions: GuardrailDecisionRecord[];
};

export type ToolResultGuardrailRunResult = {
  result: string;
  structuredResult?: ToolResultContent[] | undefined;
  blocked: boolean;
  message?: string | undefined;
  decisions: GuardrailDecisionRecord[];
};

export type OutputGuardrailRunResult = {
  outputText: string;
  blocked: boolean;
  message?: string | undefined;
  decisions: GuardrailDecisionRecord[];
};

export function defineGuardrailPolicy(options: GuardrailPolicyOptions): GuardrailPolicy {
  return {
    id: options.id,
    mode: options.mode ?? "enforce",
    input: options.input ?? [],
    tools: options.tools ?? [],
    toolResults: options.toolResults ?? [],
    output: options.output ?? [],
  };
}

export function defineInputGuardrail(guardrail: InputGuardrail): InputGuardrail {
  return guardrail;
}

export function defineToolGuardrail<Args = unknown>(
  guardrail: ToolGuardrail<Args>,
): ToolGuardrail<Args> {
  return guardrail;
}

export function defineToolResultGuardrail<Args = unknown>(
  guardrail: ToolResultGuardrail<Args>,
): ToolResultGuardrail<Args> {
  return guardrail;
}

export function defineOutputGuardrail(guardrail: OutputGuardrail): OutputGuardrail {
  return guardrail;
}

export function allow(options: GuardrailActionBase = {}): GuardrailAllow {
  return { action: "allow", ...options };
}

export function block(options: Omit<GuardrailBlock, "action">): GuardrailBlock {
  return { action: "block", ...options };
}

export const guardrails = {
  blockText,
  redactText,
};

export function normalizeGuardrailPolicies(
  policies: GuardrailPolicyInput | undefined,
): GuardrailPolicy[] {
  if (policies === undefined) {
    return [];
  }
  return Array.isArray(policies) ? policies : [policies];
}

export function appendGuardrailPolicies(
  current: GuardrailPolicy[],
  next: GuardrailPolicyInput,
): GuardrailPolicy[] {
  return [...current, ...normalizeGuardrailPolicies(next)];
}

export function hasEnforcedOutputGuardrails(policies: GuardrailPolicy[]): boolean {
  return policies.some((policy) => policy.mode === "enforce" && policy.output.length > 0);
}

export async function runInputGuardrails(
  policies: GuardrailPolicy[],
  context: InputGuardrailContext,
): Promise<InputGuardrailRunResult> {
  let prompt = context.prompt;
  let inputText = context.inputText;
  const decisions: GuardrailDecisionRecord[] = [];

  for (const policy of policies) {
    for (const guardrail of policy.input) {
      const currentContext = { ...context, prompt, inputText };
      const result = await runGuardrail(policy, guardrail.id, "input", () =>
        guardrail.check(currentContext, inputActions),
      );
      decisions.push(result.decision);

      if (policy.mode === "observe") {
        continue;
      }
      if (result.action.action === "block") {
        return {
          prompt,
          inputText,
          blocked: true,
          message: result.action.message,
          decisions,
        };
      }
      if (result.action.action === "rewrite") {
        if (result.action.prompt !== undefined) {
          prompt = result.action.prompt;
          inputText = textFromMessage(prompt);
        } else if (result.action.inputText !== undefined) {
          inputText = result.action.inputText;
          prompt = rewriteMessageText(prompt, inputText);
        }
      }
    }
  }

  return { prompt, inputText, blocked: false, decisions };
}

export async function runToolGuardrails<Args>(
  policies: GuardrailPolicy[],
  toolGuardrails: ToolGuardrail<Args>[],
  context: ToolGuardrailContext<Args>,
): Promise<ToolGuardrailRunResult> {
  let rawArgs = context.rawArgs;
  let args = context.args;
  const decisions: GuardrailDecisionRecord[] = [];

  for (const entry of toolGuardrailEntries(policies, toolGuardrails, context.toolName)) {
    const currentContext = { ...context, rawArgs, args };
    const result = await runGuardrail(entry.policy, entry.guardrail.id, "tool", () =>
      entry.guardrail.check(currentContext, toolActions),
    );
    decisions.push(result.decision);

    if (entry.policy.mode === "observe") {
      continue;
    }
    if (result.action.action === "block") {
      return {
        rawArgs,
        blocked: true,
        message: result.action.message,
        decisions,
      };
    }
    if (result.action.action === "request_approval") {
      return {
        rawArgs,
        blocked: false,
        approval: {
          reason: result.action.reason,
          rejectMessage: result.action.rejectMessage,
        },
        decisions,
      };
    }
    if (result.action.action === "rewrite") {
      rawArgs =
        typeof result.action.args === "string"
          ? result.action.args
          : JSON.stringify(result.action.args);
      try {
        args = JSON.parse(rawArgs) as Args;
      } catch {
        args = rawArgs as Args;
      }
    }
  }

  return { rawArgs, blocked: false, decisions };
}

export async function runToolResultGuardrails<Args>(
  policies: GuardrailPolicy[],
  toolGuardrails: ToolResultGuardrail<Args>[],
  context: ToolResultGuardrailContext<Args>,
): Promise<ToolResultGuardrailRunResult> {
  let result = context.result;
  let structuredResult = context.structuredResult;
  const decisions: GuardrailDecisionRecord[] = [];

  for (const entry of toolResultGuardrailEntries(policies, toolGuardrails, context.toolName)) {
    const currentContext = { ...context, result, structuredResult };
    const guardrailResult = await runGuardrail(
      entry.policy,
      entry.guardrail.id,
      "tool_result",
      () => entry.guardrail.check(currentContext, toolResultActions),
    );
    decisions.push(guardrailResult.decision);

    if (entry.policy.mode === "observe") {
      continue;
    }
    if (guardrailResult.action.action === "block") {
      return {
        result,
        structuredResult,
        blocked: true,
        message: guardrailResult.action.message,
        decisions,
      };
    }
    if (guardrailResult.action.action === "rewrite") {
      if (guardrailResult.action.structuredResult !== undefined) {
        structuredResult = guardrailResult.action.structuredResult;
        result = textFromToolResultContent(structuredResult);
      } else if (guardrailResult.action.result !== undefined) {
        result = guardrailResult.action.result;
        structuredResult = undefined;
      }
    }
  }

  return { result, structuredResult, blocked: false, decisions };
}

export async function runOutputGuardrails(
  policies: GuardrailPolicy[],
  context: OutputGuardrailContext,
): Promise<OutputGuardrailRunResult> {
  let outputText = context.outputText;
  const decisions: GuardrailDecisionRecord[] = [];

  for (const policy of policies) {
    for (const guardrail of policy.output) {
      const currentContext = { ...context, outputText };
      const result = await runGuardrail(policy, guardrail.id, "output", () =>
        guardrail.check(currentContext, outputActions),
      );
      decisions.push(result.decision);

      if (policy.mode === "observe") {
        continue;
      }
      if (result.action.action === "block") {
        return {
          outputText,
          blocked: true,
          message: result.action.message,
          decisions,
        };
      }
      if (result.action.action === "rewrite") {
        outputText = result.action.outputText;
      }
    }
  }

  return { outputText, blocked: false, decisions };
}

type RunGuardrailResult<TAction extends { action: GuardrailActionName }> = {
  action: TAction;
  decision: GuardrailDecisionRecord;
};

async function runGuardrail<TAction extends { action: GuardrailActionName } & GuardrailActionBase>(
  policy: GuardrailPolicy,
  guardrailId: string,
  boundary: GuardrailBoundary,
  run: () => MaybePromise<TAction | undefined>,
): Promise<RunGuardrailResult<TAction | GuardrailAllow>> {
  const startedAt = Date.now();
  try {
    const action = (await run()) ?? allow();
    return {
      action,
      decision: decisionRecord({
        policy,
        guardrailId,
        boundary,
        action,
        latencyMs: Date.now() - startedAt,
      }),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (policy.mode === "observe") {
      return {
        action: allow(),
        decision: {
          policyId: policy.id,
          guardrailId,
          boundary,
          mode: policy.mode,
          action: "error",
          applied: false,
          reason: message,
          latencyMs: Date.now() - startedAt,
        },
      };
    }
    throw error;
  }
}

function decisionRecord(args: {
  policy: GuardrailPolicy;
  guardrailId: string;
  boundary: GuardrailBoundary;
  action: GuardrailAllow | GuardrailBlock | ({ action: GuardrailActionName } & GuardrailActionBase);
  latencyMs: number;
}): GuardrailDecisionRecord {
  const applied = args.policy.mode === "enforce" && args.action.action !== "allow";
  const record: GuardrailDecisionRecord = {
    policyId: args.policy.id,
    guardrailId: args.guardrailId,
    boundary: args.boundary,
    mode: args.policy.mode,
    action: args.action.action,
    applied,
    latencyMs: args.latencyMs,
  };
  if (args.action.reason !== undefined) record.reason = args.action.reason;
  if ("message" in args.action && typeof args.action.message === "string") {
    record.message = args.action.message;
  }
  if (args.action.metadata !== undefined) record.metadata = args.action.metadata;
  return record;
}

const commonActions: GuardrailCommonActions = {
  allow,
  block,
};

const inputActions: InputGuardrailActions = {
  ...commonActions,
  rewrite(options) {
    return { action: "rewrite", ...options };
  },
};

const toolActions: ToolGuardrailActions = {
  ...commonActions,
  rewrite(options) {
    return { action: "rewrite", ...options };
  },
  requestApproval(options = {}) {
    return { action: "request_approval", ...options };
  },
};

const toolResultActions: ToolResultGuardrailActions = {
  ...commonActions,
  rewrite(options) {
    return { action: "rewrite", ...options };
  },
};

const outputActions: OutputGuardrailActions = {
  ...commonActions,
  rewrite(options) {
    return { action: "rewrite", ...options };
  },
};

function toolGuardrailEntries<Args>(
  policies: GuardrailPolicy[],
  toolGuardrails: ToolGuardrail<Args>[],
  toolName: string,
): Array<{ policy: GuardrailPolicy; guardrail: ToolGuardrail<Args> }> {
  return [
    ...policies.flatMap((policy) =>
      policy.tools
        .filter((guardrail) => matchesTool(guardrail.tool, toolName))
        .map((guardrail) => ({ policy, guardrail: guardrail as ToolGuardrail<Args> })),
    ),
    ...toolGuardrails.map((guardrail) => ({
      policy: defineGuardrailPolicy({
        id: `tool:${toolName}:${guardrail.id}`,
        tools: [guardrail],
      }),
      guardrail,
    })),
  ];
}

function toolResultGuardrailEntries<Args>(
  policies: GuardrailPolicy[],
  toolGuardrails: ToolResultGuardrail<Args>[],
  toolName: string,
): Array<{ policy: GuardrailPolicy; guardrail: ToolResultGuardrail<Args> }> {
  return [
    ...policies.flatMap((policy) =>
      policy.toolResults
        .filter((guardrail) => matchesTool(guardrail.tool, toolName))
        .map((guardrail) => ({ policy, guardrail: guardrail as ToolResultGuardrail<Args> })),
    ),
    ...toolGuardrails.map((guardrail) => ({
      policy: defineGuardrailPolicy({
        id: `tool:${toolName}:${guardrail.id}`,
        toolResults: [guardrail],
      }),
      guardrail,
    })),
  ];
}

function matchesTool(tool: string | string[] | undefined, toolName: string): boolean {
  if (tool === undefined) {
    return true;
  }
  return Array.isArray(tool) ? tool.includes(toolName) : tool === toolName;
}

type TextPatternBoundary = "input" | "output" | "tool_result";

type TextPatternGuardrailFor<Boundary extends TextPatternBoundary> = Boundary extends "input"
  ? InputGuardrail
  : Boundary extends "output"
    ? OutputGuardrail
    : ToolResultGuardrail;

type TextPatternGuardrailOptions<Boundary extends TextPatternBoundary = TextPatternBoundary> = {
  id: string;
  boundary: Boundary;
  patterns: Array<string | RegExp>;
  reason: string;
  message?: string | undefined;
};

type TextPatternRedactOptions<Boundary extends TextPatternBoundary = TextPatternBoundary> =
  TextPatternGuardrailOptions<Boundary> & { replacement?: string | undefined };

function blockText<Boundary extends TextPatternBoundary>(
  options: TextPatternGuardrailOptions<Boundary>,
): TextPatternGuardrailFor<Boundary> {
  return textPatternGuardrail(options, "block");
}

function redactText<Boundary extends TextPatternBoundary>(
  options: TextPatternRedactOptions<Boundary>,
): TextPatternGuardrailFor<Boundary> {
  return textPatternGuardrail(options, "rewrite");
}

function textPatternGuardrail<Boundary extends TextPatternBoundary>(
  options: TextPatternRedactOptions<Boundary>,
  action: "block" | "rewrite",
): TextPatternGuardrailFor<Boundary> {
  if (options.boundary === "input") {
    return defineInputGuardrail({
      id: options.id,
      check(ctx, actions) {
        return textPatternAction(ctx.inputText, options, action, (value) =>
          actions.rewrite({ inputText: value, reason: options.reason }),
        );
      },
    }) as TextPatternGuardrailFor<Boundary>;
  }
  if (options.boundary === "output") {
    return defineOutputGuardrail({
      id: options.id,
      check(ctx, actions) {
        return textPatternAction(ctx.outputText, options, action, (value) =>
          actions.rewrite({ outputText: value, reason: options.reason }),
        );
      },
    }) as TextPatternGuardrailFor<Boundary>;
  }
  return defineToolResultGuardrail({
    id: options.id,
    check(ctx, actions) {
      return textPatternAction(ctx.result, options, action, (value) =>
        actions.rewrite({ result: value, reason: options.reason }),
      );
    },
  }) as TextPatternGuardrailFor<Boundary>;
}

function textPatternAction<TRewrite>(
  text: string,
  options: TextPatternGuardrailOptions & { replacement?: string | undefined },
  action: "block" | "rewrite",
  rewrite: (value: string) => TRewrite,
): GuardrailAllow | GuardrailBlock | TRewrite {
  const matched = options.patterns.some((pattern) => textPatternMatches(text, pattern));
  if (!matched) {
    return allow();
  }
  if (action === "block") {
    return block({
      reason: options.reason,
      message: options.message,
    });
  }
  let current = text;
  for (const pattern of options.patterns) {
    current = replaceTextPattern(current, pattern, options.replacement ?? "[redacted]");
  }
  return rewrite(current);
}

function textPatternMatches(text: string, pattern: string | RegExp): boolean {
  if (typeof pattern === "string") {
    return text.includes(pattern);
  }
  pattern.lastIndex = 0;
  const matched = pattern.test(text);
  pattern.lastIndex = 0;
  return matched;
}

function replaceTextPattern(text: string, pattern: string | RegExp, replacement: string): string {
  if (typeof pattern === "string") {
    return text.split(pattern).join(replacement);
  }
  pattern.lastIndex = 0;
  const flags = pattern.flags.replace("y", "");
  const globalFlags = flags.includes("g") ? flags : `${flags}g`;
  return text.replace(new RegExp(pattern.source, globalFlags), replacement);
}

function textFromMessage(message: Message): string {
  if (message.role === "system") {
    return message.content;
  }
  return message.content
    .flatMap((content) => {
      if (content.type === "text") {
        return [content.text];
      }
      if (content.type === "document" && content.source.type === "text") {
        return [content.source.text];
      }
      return [];
    })
    .join("\n");
}

function rewriteMessageText(message: Message, text: string): Message {
  if (message.role === "system") {
    return { ...message, content: text };
  }
  if (message.role === "user") {
    return {
      ...message,
      content: [
        { type: "text", text },
        ...message.content.filter(
          (item) =>
            item.type !== "text" && !(item.type === "document" && item.source.type === "text"),
        ),
      ],
    };
  }
  if (message.role === "assistant") {
    return { ...message, content: [{ type: "text", text }] };
  }
  return message;
}

function textFromToolResultContent(content: ToolResultContent[]): string {
  return content.map((item) => (item.type === "text" ? item.text : "[image]")).join("\n");
}
