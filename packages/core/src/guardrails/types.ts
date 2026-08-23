import type { JsonObject, Message, Usage } from "../completion";
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
