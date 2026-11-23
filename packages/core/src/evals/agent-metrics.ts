import type { Message, ToolCallPart, Usage } from "../completion";
import { evalValuesEqual, formatValue } from "./format";
import { EvalOutcome } from "./outcome";
import type { EvalMetric, EvalMetricArgs, ValueSelector } from "./types";

type MessagesSource = readonly Message[] | { messages: readonly Message[] };

export type ToolCalledOptions<Input, Output, Expected = unknown> = {
  name?: string | undefined;
  required?: boolean | undefined;
  toolName: string;
  minCalls?: number | undefined;
  maxCalls?: number | undefined;
  args?: Record<string, unknown> | ((input: unknown) => boolean) | undefined;
  messages?: ValueSelector<Input, Output, Expected, MessagesSource> | undefined;
};

/** Checks that an agent invoked a tool (optionally matching call count and input arguments). */
export function toolCalled<Input, Output, Expected = unknown, const Name extends string = string>(
  toolName: string,
  options?: Omit<ToolCalledOptions<Input, Output, Expected>, "toolName"> & {
    name?: Name | undefined;
  },
): EvalMetric<Input, Output, boolean, Expected, Name>;
export function toolCalled<Input, Output, Expected = unknown, const Name extends string = string>(
  options: ToolCalledOptions<Input, Output, Expected> & { name?: Name | undefined },
): EvalMetric<Input, Output, boolean, Expected, Name>;
export function toolCalled<Input, Output, Expected = unknown, const Name extends string = string>(
  optionsOrToolName:
    | string
    | (ToolCalledOptions<Input, Output, Expected> & { name?: Name | undefined }),
  extraOptions?: Omit<ToolCalledOptions<Input, Output, Expected>, "toolName"> & {
    name?: Name | undefined;
  },
): EvalMetric<Input, Output, boolean, Expected, Name> {
  const options: ToolCalledOptions<Input, Output, Expected> & { name?: Name | undefined } =
    typeof optionsOrToolName === "string"
      ? { ...extraOptions, toolName: optionsOrToolName }
      : optionsOrToolName;

  if (options.toolName.trim().length === 0) {
    throw new TypeError("toolCalled toolName must not be empty.");
  }

  const minCalls = options.minCalls ?? 1;

  if (!Number.isSafeInteger(minCalls) || minCalls < 0) {
    throw new RangeError("toolCalled minCalls must be a non-negative integer.");
  }

  if (
    options.maxCalls !== undefined &&
    (!Number.isSafeInteger(options.maxCalls) || options.maxCalls < minCalls)
  ) {
    throw new RangeError("toolCalled maxCalls must be an integer >= minCalls.");
  }

  return {
    name: (options.name ?? `tool_called_${options.toolName}`) as Name,
    required: options.required ?? true,
    dataType: "BOOLEAN",
    direction: "higher_is_better",
    threshold: 1,
    async evaluate(args) {
      const messages = await resolveMessages(options.messages, args);

      if (messages === undefined) {
        return EvalOutcome.invalid(
          "toolCalled requires an AgentResponse, Message[], or an output with messages.",
        );
      }

      const calls = extractToolCalls(messages);
      const matchingByName = calls.filter((call) => call.toolName === options.toolName);
      const matching =
        options.args === undefined
          ? matchingByName
          : matchingByName.filter((call) => matchesToolArgs(call.input, options.args!));

      const count = matching.length;
      const withinMin = count >= minCalls;
      const withinMax = options.maxCalls === undefined || count <= options.maxCalls;

      if (withinMin && withinMax) {
        return EvalOutcome.pass(true, {
          metadata: {
            toolName: options.toolName,
            callCount: count,
          },
        });
      }

      const observedTools = calls.map((call) => call.toolName);
      const observedSummary = observedTools.length === 0 ? "none" : observedTools.join(", ");
      let boundText: string;

      if (options.maxCalls === undefined) {
        boundText = `at least ${minCalls}`;
      } else if (minCalls === options.maxCalls) {
        boundText = `exactly ${minCalls}`;
      } else {
        boundText = `between ${minCalls} and ${options.maxCalls}`;
      }

      const argsNote = options.args === undefined ? "" : " matching expected args";
      return EvalOutcome.fail(false, {
        comment: `Tool "${options.toolName}"${argsNote} was called ${count} time(s) (expected ${boundText}). Called tools: ${observedSummary}.`,
        metadata: {
          toolName: options.toolName,
          callCount: count,
          calledTools: observedTools,
        },
      });
    },
  };
}

export type ToolNotCalledOptions<Input, Output, Expected = unknown> = {
  name?: string | undefined;
  required?: boolean | undefined;
  toolName: string;
  messages?: ValueSelector<Input, Output, Expected, MessagesSource> | undefined;
};

/** Checks that an agent did not invoke a forbidden tool. */
export function toolNotCalled<
  Input,
  Output,
  Expected = unknown,
  const Name extends string = string,
>(
  toolName: string,
  options?: Omit<ToolNotCalledOptions<Input, Output, Expected>, "toolName"> & {
    name?: Name | undefined;
  },
): EvalMetric<Input, Output, boolean, Expected, Name>;
export function toolNotCalled<
  Input,
  Output,
  Expected = unknown,
  const Name extends string = string,
>(
  options: ToolNotCalledOptions<Input, Output, Expected> & { name?: Name | undefined },
): EvalMetric<Input, Output, boolean, Expected, Name>;
export function toolNotCalled<
  Input,
  Output,
  Expected = unknown,
  const Name extends string = string,
>(
  optionsOrToolName:
    | string
    | (ToolNotCalledOptions<Input, Output, Expected> & { name?: Name | undefined }),
  extraOptions?: Omit<ToolNotCalledOptions<Input, Output, Expected>, "toolName"> & {
    name?: Name | undefined;
  },
): EvalMetric<Input, Output, boolean, Expected, Name> {
  const options: ToolNotCalledOptions<Input, Output, Expected> & { name?: Name | undefined } =
    typeof optionsOrToolName === "string"
      ? { ...extraOptions, toolName: optionsOrToolName }
      : optionsOrToolName;

  if (options.toolName.trim().length === 0) {
    throw new TypeError("toolNotCalled toolName must not be empty.");
  }

  return {
    name: (options.name ?? `tool_not_called_${options.toolName}`) as Name,
    required: options.required ?? true,
    dataType: "BOOLEAN",
    direction: "higher_is_better",
    threshold: 1,
    async evaluate(args) {
      const messages = await resolveMessages(options.messages, args);

      if (messages === undefined) {
        return EvalOutcome.invalid(
          "toolNotCalled requires an AgentResponse, Message[], or an output with messages.",
        );
      }

      const calls = extractToolCalls(messages);
      const count = calls.filter((call) => call.toolName === options.toolName).length;
      return count === 0
        ? EvalOutcome.pass(true)
        : EvalOutcome.fail(false, {
            comment: `Forbidden tool "${options.toolName}" was called ${count} time(s).`,
            metadata: { toolName: options.toolName, callCount: count },
          });
    },
  };
}

export type ToolCallOrderOptions<Input, Output, Expected = unknown> = {
  name?: string | undefined;
  required?: boolean | undefined;
  tools: readonly string[];
  strict?: boolean | undefined;
  messages?: ValueSelector<Input, Output, Expected, MessagesSource> | undefined;
};

/** Checks that an agent invoked tools in the expected order (subsequence by default, or exact sequence when strict is true). */
export function toolCallOrder<
  Input,
  Output,
  Expected = unknown,
  const Name extends string = string,
>(
  tools: readonly string[],
  options?: Omit<ToolCallOrderOptions<Input, Output, Expected>, "tools"> & {
    name?: Name | undefined;
  },
): EvalMetric<Input, Output, boolean, Expected, Name>;
export function toolCallOrder<
  Input,
  Output,
  Expected = unknown,
  const Name extends string = string,
>(
  options: ToolCallOrderOptions<Input, Output, Expected> & { name?: Name | undefined },
): EvalMetric<Input, Output, boolean, Expected, Name>;
export function toolCallOrder<
  Input,
  Output,
  Expected = unknown,
  const Name extends string = string,
>(
  optionsOrTools:
    | readonly string[]
    | (ToolCallOrderOptions<Input, Output, Expected> & { name?: Name | undefined }),
  extraOptions?: Omit<ToolCallOrderOptions<Input, Output, Expected>, "tools"> & {
    name?: Name | undefined;
  },
): EvalMetric<Input, Output, boolean, Expected, Name> {
  const options: ToolCallOrderOptions<Input, Output, Expected> & { name?: Name | undefined } =
    Array.isArray(optionsOrTools)
      ? { ...extraOptions, tools: optionsOrTools }
      : (optionsOrTools as ToolCallOrderOptions<Input, Output, Expected> & {
          name?: Name | undefined;
        });

  if (options.tools.length === 0) {
    throw new TypeError("toolCallOrder tools must not be empty.");
  }

  const strict = options.strict ?? false;
  return {
    name: (options.name ?? "tool_call_order") as Name,
    required: options.required ?? true,
    dataType: "BOOLEAN",
    direction: "higher_is_better",
    threshold: 1,
    async evaluate(args) {
      const messages = await resolveMessages(options.messages, args);

      if (messages === undefined) {
        return EvalOutcome.invalid(
          "toolCallOrder requires an AgentResponse, Message[], or an output with messages.",
        );
      }

      const actual = extractToolCalls(messages).map((call) => call.toolName);
      const passed = strict
        ? actual.length === options.tools.length &&
          actual.every((name, index) => name === options.tools[index])
        : isSubsequence(options.tools, actual);

      return passed
        ? EvalOutcome.pass(true, { metadata: { calledTools: actual } })
        : EvalOutcome.fail(false, {
            comment: `Expected tool order [${options.tools.join(" -> ")}] (${strict ? "strict" : "subsequence"}), received [${actual.join(" -> ")}].`,
            metadata: { calledTools: actual, expectedTools: [...options.tools] },
          });
    },
  };
}

export type MaxTurnsOptions<Input, Output, Expected = unknown> = {
  name?: string | undefined;
  required?: boolean | undefined;
  max: number;
  messages?: ValueSelector<Input, Output, Expected, MessagesSource> | undefined;
};

/** Checks that the number of assistant turns in an agent response does not exceed max. */
export function maxTurns<Input, Output, Expected = unknown, const Name extends string = string>(
  max: number,
  options?: Omit<MaxTurnsOptions<Input, Output, Expected>, "max"> & { name?: Name | undefined },
): EvalMetric<Input, Output, number, Expected, Name>;
export function maxTurns<Input, Output, Expected = unknown, const Name extends string = string>(
  options: MaxTurnsOptions<Input, Output, Expected> & { name?: Name | undefined },
): EvalMetric<Input, Output, number, Expected, Name>;
export function maxTurns<Input, Output, Expected = unknown, const Name extends string = string>(
  optionsOrMax: number | (MaxTurnsOptions<Input, Output, Expected> & { name?: Name | undefined }),
  extraOptions?: Omit<MaxTurnsOptions<Input, Output, Expected>, "max"> & {
    name?: Name | undefined;
  },
): EvalMetric<Input, Output, number, Expected, Name> {
  const options: MaxTurnsOptions<Input, Output, Expected> & { name?: Name | undefined } =
    typeof optionsOrMax === "number" ? { ...extraOptions, max: optionsOrMax } : optionsOrMax;

  if (!Number.isSafeInteger(options.max) || options.max < 1) {
    throw new RangeError("maxTurns max must be a positive integer.");
  }

  return {
    name: (options.name ?? "max_turns") as Name,
    required: options.required ?? true,
    dataType: "NUMERIC",
    direction: "lower_is_better",
    threshold: options.max,
    async evaluate(args) {
      const messages = await resolveMessages(options.messages, args);

      if (messages === undefined) {
        return EvalOutcome.invalid(
          "maxTurns requires an AgentResponse, Message[], or an output with messages.",
        );
      }

      const turns = messages.filter((message) => message.role === "assistant").length;
      return turns <= options.max
        ? EvalOutcome.pass(turns)
        : EvalOutcome.fail(turns, {
            comment: `Agent took ${turns} assistant turn(s), exceeding maximum ${options.max}.`,
          });
    },
  };
}

export type MaxTokensOptions<Input, Output, Expected = unknown> = {
  name?: string | undefined;
  required?: boolean | undefined;
  max: number;
  field?: "total" | "input" | "output" | undefined;
  usage?: ValueSelector<Input, Output, Expected, Usage | undefined> | undefined;
};

/** Checks that target token usage stays within the configured token budget. */
export function maxTokens<Input, Output, Expected = unknown, const Name extends string = string>(
  max: number,
  options?: Omit<MaxTokensOptions<Input, Output, Expected>, "max"> & { name?: Name | undefined },
): EvalMetric<Input, Output, number, Expected, Name>;
export function maxTokens<Input, Output, Expected = unknown, const Name extends string = string>(
  options: MaxTokensOptions<Input, Output, Expected> & { name?: Name | undefined },
): EvalMetric<Input, Output, number, Expected, Name>;
export function maxTokens<Input, Output, Expected = unknown, const Name extends string = string>(
  optionsOrMax: number | (MaxTokensOptions<Input, Output, Expected> & { name?: Name | undefined }),
  extraOptions?: Omit<MaxTokensOptions<Input, Output, Expected>, "max"> & {
    name?: Name | undefined;
  },
): EvalMetric<Input, Output, number, Expected, Name> {
  const options: MaxTokensOptions<Input, Output, Expected> & { name?: Name | undefined } =
    typeof optionsOrMax === "number" ? { ...extraOptions, max: optionsOrMax } : optionsOrMax;

  if (!Number.isSafeInteger(options.max) || options.max < 0) {
    throw new RangeError("maxTokens max must be a non-negative integer.");
  }

  const field = options.field ?? "total";
  return {
    name: (options.name ?? "max_tokens") as Name,
    required: options.required ?? true,
    dataType: "NUMERIC",
    direction: "lower_is_better",
    threshold: options.max,
    async evaluate(args) {
      const usage =
        options.usage === undefined ? readUsage(args.output) : await options.usage(args);

      if (usage === undefined) {
        return EvalOutcome.invalid(
          "maxTokens requires an output with usage or an explicit usage selector.",
        );
      }

      let tokens: number;

      if (field === "input") {
        tokens = usage.inputTokens;
      } else if (field === "output") {
        tokens = usage.outputTokens;
      } else {
        tokens = usage.totalTokens;
      }

      return tokens <= options.max
        ? EvalOutcome.pass(tokens)
        : EvalOutcome.fail(tokens, {
            comment: `Target used ${tokens} ${field} tokens, exceeding maximum ${options.max}.`,
          });
    },
  };
}

export type MaxDurationMsOptions<Input, Output, Expected = unknown> = {
  name?: string | undefined;
  required?: boolean | undefined;
  max: number;
  durationMs?: ValueSelector<Input, Output, Expected, number> | undefined;
};

/** Checks that target execution latency stays within max milliseconds. */
export function maxDurationMs<
  Input,
  Output,
  Expected = unknown,
  const Name extends string = string,
>(
  max: number,
  options?: Omit<MaxDurationMsOptions<Input, Output, Expected>, "max"> & {
    name?: Name | undefined;
  },
): EvalMetric<Input, Output, number, Expected, Name>;
export function maxDurationMs<
  Input,
  Output,
  Expected = unknown,
  const Name extends string = string,
>(
  options: MaxDurationMsOptions<Input, Output, Expected> & { name?: Name | undefined },
): EvalMetric<Input, Output, number, Expected, Name>;
export function maxDurationMs<
  Input,
  Output,
  Expected = unknown,
  const Name extends string = string,
>(
  optionsOrMax:
    | number
    | (MaxDurationMsOptions<Input, Output, Expected> & { name?: Name | undefined }),
  extraOptions?: Omit<MaxDurationMsOptions<Input, Output, Expected>, "max"> & {
    name?: Name | undefined;
  },
): EvalMetric<Input, Output, number, Expected, Name> {
  const options: MaxDurationMsOptions<Input, Output, Expected> & { name?: Name | undefined } =
    typeof optionsOrMax === "number" ? { ...extraOptions, max: optionsOrMax } : optionsOrMax;

  if (!Number.isFinite(options.max) || options.max < 0) {
    throw new RangeError("maxDurationMs max must be a non-negative finite number.");
  }

  return {
    name: (options.name ?? "max_duration_ms") as Name,
    required: options.required ?? true,
    dataType: "NUMERIC",
    direction: "lower_is_better",
    threshold: options.max,
    async evaluate(args) {
      const durationMs =
        options.durationMs === undefined ? args.targetDurationMs : await options.durationMs(args);

      if (durationMs === undefined || !Number.isFinite(durationMs) || durationMs < 0) {
        return EvalOutcome.invalid("maxDurationMs requires a non-negative finite target duration.");
      }

      const rounded = Math.round(durationMs * 100) / 100;
      return durationMs <= options.max
        ? EvalOutcome.pass(rounded)
        : EvalOutcome.fail(rounded, {
            comment: `Target duration ${rounded}ms exceeded maximum ${formatValue(options.max)}ms.`,
          });
    },
  };
}

async function resolveMessages<Input, Output, Expected>(
  selector: ValueSelector<Input, Output, Expected, MessagesSource> | undefined,
  args: EvalMetricArgs<Input, Output, Expected>,
): Promise<readonly Message[] | undefined> {
  const source: unknown = selector === undefined ? args.output : await selector(args);

  if (Array.isArray(source)) return source as readonly Message[];

  if (typeof source === "object" && source !== null && "messages" in source) {
    const messages = (source as { messages?: unknown }).messages;

    if (Array.isArray(messages)) return messages as readonly Message[];
  }

  return undefined;
}

function extractToolCalls(messages: readonly Message[]): ToolCallPart[] {
  const calls: ToolCallPart[] = [];
  for (const message of messages) {
    if (message.role !== "assistant" || !Array.isArray(message.content)) continue;

    for (const part of message.content) {
      if (typeof part === "object" && part !== null && part.type === "tool-call") {
        calls.push(part);
      }
    }
  }
  return calls;
}

function matchesToolArgs(
  input: unknown,
  matcher: Record<string, unknown> | ((input: unknown) => boolean),
): boolean {
  if (typeof matcher === "function") return matcher(input);

  if (typeof input !== "object" || input === null || Array.isArray(input)) return false;

  for (const [key, expectedValue] of Object.entries(matcher)) {
    if (!Object.hasOwn(input, key)) return false;

    if (!evalValuesEqual((input as Record<string, unknown>)[key], expectedValue)) {
      return false;
    }
  }

  return true;
}

function isSubsequence(expected: readonly string[], actual: readonly string[]): boolean {
  let cursor = 0;
  for (const name of actual) {
    if (name === expected[cursor]) {
      cursor += 1;

      if (cursor === expected.length) return true;
    }
  }
  return cursor === expected.length;
}

function readUsage(output: unknown): Usage | undefined {
  if (typeof output !== "object" || output === null || !("usage" in output)) return undefined;

  const usage = (output as { usage?: unknown }).usage;

  if (
    typeof usage === "object" &&
    usage !== null &&
    "totalTokens" in usage &&
    typeof (usage as { totalTokens?: unknown }).totalTokens === "number"
  ) {
    return usage as Usage;
  }

  return undefined;
}
