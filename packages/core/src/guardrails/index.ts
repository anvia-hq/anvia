import type { JsonObject, Message, ToolResultPart, Usage } from "../completion";
import type { MaybePromise } from "../internal/type-utils";

export type GuardrailMode = "enforce" | "observe";

export type GuardrailBoundary = "input" | "output";

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

export type GuardrailActionName = "allow" | "block" | "rewrite" | "error";

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

export type OutputGuardrailRewrite = GuardrailActionBase & {
  action: "rewrite";
  outputText: string;
};

export type InputGuardrailResult = GuardrailAllow | GuardrailBlock | InputGuardrailRewrite;
export type OutputGuardrailResult = GuardrailAllow | GuardrailBlock | OutputGuardrailRewrite;

export type GuardrailCommonActions = {
  allow(options?: GuardrailActionBase): GuardrailAllow;
  block(options: Omit<GuardrailBlock, "action">): GuardrailBlock;
};

export type InputGuardrailActions = GuardrailCommonActions & {
  rewrite(options: Omit<InputGuardrailRewrite, "action">): InputGuardrailRewrite;
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
  output: OutputGuardrail[];
};

export type GuardrailPolicyOptions = {
  id: string;
  mode?: GuardrailMode | undefined;
  input?: InputGuardrail[] | undefined;
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
    output: options.output ?? [],
  };
}

export function defineInputGuardrail(guardrail: InputGuardrail): InputGuardrail {
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

const outputActions: OutputGuardrailActions = {
  ...commonActions,
  rewrite(options) {
    return { action: "rewrite", ...options };
  },
};

type TextPatternBoundary = "input" | "output";

type TextPatternGuardrailFor<Boundary extends TextPatternBoundary> = Boundary extends "input"
  ? InputGuardrail
  : OutputGuardrail;

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
  return defineOutputGuardrail({
    id: options.id,
    check(ctx, actions) {
      return textPatternAction(ctx.outputText, options, action, (value) =>
        actions.rewrite({ outputText: value, reason: options.reason }),
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
  if (typeof message.content === "string") {
    return message.content;
  }
  return message.content
    .flatMap((content) => {
      if (content.type === "text") {
        return [content.text];
      }
      if (content.type === "file" && content.data.type === "text") {
        return [content.data.text];
      }
      if (content.type === "tool-result") {
        return textFromToolResult(content.output);
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
    const content = typeof message.content === "string" ? [] : message.content;
    return {
      ...message,
      content: [
        { type: "text", text },
        ...content.filter(
          (item) => item.type !== "text" && !(item.type === "file" && item.data.type === "text"),
        ),
      ],
    };
  }
  if (message.role === "assistant") {
    return { ...message, content: [{ type: "text", text }] };
  }
  return message;
}

function textFromToolResult(output: ToolResultPart["output"]): string[] {
  switch (output.type) {
    case "text":
    case "error-text":
      return [output.value];
    case "json":
    case "error-json":
      return [JSON.stringify(output.value)];
    case "content":
      return output.value.flatMap((part) => (part.type === "text" ? [part.text] : []));
    case "execution-denied":
      return output.reason === undefined ? [] : [output.reason];
  }
}
