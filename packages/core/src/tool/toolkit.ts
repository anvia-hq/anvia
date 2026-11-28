import type { JsonValue, ToolDefinition } from "../completion/types";
import { isMcpTool } from "../mcp";
import { assertToolApprovalRequirement } from "./approval-requirement";
import { copyPreparedToolOwner } from "./prepared-tool-call";
import { hasQuestionToolMarker, markQuestionTool } from "./question-tool-marker";
import { isSkillTool, markSkillTool } from "./skill-tool-marker";
import type { AnyTool, ToolCallContext, ToolRequiresApproval } from "./tool";

export interface Toolkit {
  readonly kind: "toolkit";
  readonly name: string;
  readonly tools: readonly AnyTool[];
  readonly instructions?: string | undefined;
}

export type ToolkitDefinition = {
  name: string;
  tools: readonly AnyTool[];
  instructions?: string | undefined;
};

export type ToolkitOptions<ToolName extends string = string> = {
  /** Only include these tools from the toolkit. */
  include?: readonly ToolName[] | undefined;
  /** Exclude these tools from the toolkit. */
  exclude?: readonly ToolName[] | undefined;
  /** Prefix prepended to every tool name (e.g. `"docs_"`). */
  prefix?: string | undefined;
  /** Override approval globally (`boolean`) or per tool name. */
  requiresApproval?: boolean | Partial<Record<ToolName, ToolRequiresApproval<unknown>>> | undefined;
  /** Per-call execution timeout in milliseconds. */
  timeoutMs?: number | undefined;
  /** Override or disable (`false`) the toolkit's default instructions. */
  instructions?: string | false | undefined;
};

export function isToolkit(value: unknown): value is Toolkit {
  if (typeof value !== "object" || value === null) return false;

  const candidate = value as {
    kind?: unknown;
    name?: unknown;
    tools?: unknown;
    instructions?: unknown;
  };
  return (
    candidate.kind === "toolkit" &&
    typeof candidate.name === "string" &&
    candidate.name.trim().length > 0 &&
    Array.isArray(candidate.tools) &&
    (candidate.instructions === undefined || typeof candidate.instructions === "string")
  );
}

export function createToolkit<ToolName extends string = string>(
  definition: ToolkitDefinition,
  options: ToolkitOptions<ToolName> = {},
): Toolkit {
  const name = definition.name.trim();

  if (name.length === 0) {
    throw new TypeError("Toolkit name must not be empty.");
  }

  const knownTools = new Map<string, AnyTool>();
  for (const tool of definition.tools) {
    if (isMcpTool(tool)) {
      throw new TypeError(
        `MCP tool "${tool.name}" must be registered through Agent.mcpServers, not toolkit "${name}".`,
      );
    }

    if (knownTools.has(tool.name)) {
      throw new TypeError(`Duplicate tool "${tool.name}" in toolkit "${name}".`);
    }

    knownTools.set(tool.name, tool);
  }

  const includeSet =
    options.include === undefined
      ? undefined
      : new Set(validateToolNames("include", options.include, knownTools, name));
  const excludeSet =
    options.exclude === undefined
      ? undefined
      : new Set(validateToolNames("exclude", options.exclude, knownTools, name));

  const prefix = options.prefix ?? "";

  if (typeof prefix !== "string") {
    throw new TypeError(`Toolkit "${name}" prefix must be a string.`);
  }

  const timeoutMs = options.timeoutMs;

  if (timeoutMs !== undefined && (!Number.isFinite(timeoutMs) || timeoutMs <= 0)) {
    throw new RangeError(`Toolkit "${name}" timeoutMs must be a positive finite number.`);
  }

  const approvalOverrides = normalizeApprovalOverrides(options.requiresApproval, knownTools, name);

  const selectedTools: AnyTool[] = [];
  for (const tool of definition.tools) {
    if (includeSet !== undefined && !includeSet.has(tool.name)) continue;

    if (excludeSet !== undefined && excludeSet.has(tool.name)) continue;

    const approvalOverride =
      typeof approvalOverrides === "boolean"
        ? approvalOverrides
        : approvalOverrides?.get(tool.name);

    selectedTools.push(
      wrapToolkitTool(tool, {
        prefix,
        approvalOverride,
        timeoutMs,
      }),
    );
  }

  const instructions = resolveToolkitInstructions(definition.instructions, options.instructions);
  const toolkit: Toolkit =
    instructions === undefined
      ? { kind: "toolkit", name, tools: Object.freeze(selectedTools) }
      : { kind: "toolkit", name, tools: Object.freeze(selectedTools), instructions };

  return Object.freeze(toolkit);
}

function validateToolNames(
  optionName: string,
  names: readonly string[],
  knownTools: ReadonlyMap<string, AnyTool>,
  toolkitName: string,
): string[] {
  const knownList = [...knownTools.keys()].join(", ");
  for (const toolName of names) {
    if (!knownTools.has(toolName)) {
      throw new TypeError(
        `Unknown tool "${toolName}" in toolkit "${toolkitName}" ${optionName} option. Available tools: ${knownList || "(none)"}.`,
      );
    }
  }
  return [...names];
}

function normalizeApprovalOverrides<ToolName extends string>(
  requiresApproval: ToolkitOptions<ToolName>["requiresApproval"],
  knownTools: ReadonlyMap<string, AnyTool>,
  toolkitName: string,
): boolean | Map<string, unknown> | undefined {
  if (requiresApproval === undefined) return undefined;

  if (typeof requiresApproval === "boolean") return requiresApproval;

  if (
    typeof requiresApproval !== "object" ||
    requiresApproval === null ||
    Array.isArray(requiresApproval)
  ) {
    throw new TypeError(
      `Toolkit "${toolkitName}" requiresApproval must be a boolean or a record keyed by tool name.`,
    );
  }

  const overrides = new Map<string, unknown>();
  for (const [toolName, requirement] of Object.entries(requiresApproval)) {
    if (requirement === undefined) continue;

    if (!knownTools.has(toolName)) {
      const knownList = [...knownTools.keys()].join(", ");
      throw new TypeError(
        `Unknown tool "${toolName}" in toolkit "${toolkitName}" requiresApproval option. Available tools: ${knownList || "(none)"}.`,
      );
    }

    assertToolApprovalRequirement(requirement, { allowFunction: true });
    overrides.set(
      toolName,
      typeof requirement === "object" && requirement !== null
        ? Object.freeze({ ...requirement })
        : requirement,
    );
  }
  return overrides;
}

function resolveToolkitInstructions(
  defaultInstructions: string | undefined,
  override: string | false | undefined,
): string | undefined {
  if (override === false) return undefined;

  const raw = override ?? defaultInstructions;

  if (raw === undefined) return undefined;

  const trimmed = raw.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

function wrapToolkitTool(
  tool: AnyTool,
  options: {
    prefix: string;
    approvalOverride: unknown;
    timeoutMs: number | undefined;
  },
): AnyTool {
  const { prefix, approvalOverride, timeoutMs } = options;
  const needsNameWrap = prefix.length > 0;
  const needsApprovalWrap = approvalOverride !== undefined;
  const needsTimeoutWrap = timeoutMs !== undefined;

  if (!needsNameWrap && !needsApprovalWrap && !needsTimeoutWrap) {
    return tool;
  }

  const name = needsNameWrap ? `${prefix}${tool.name}` : tool.name;
  const requiresApproval = needsApprovalWrap ? approvalOverride : tool.requiresApproval;

  const wrapped: {
    name: string;
    requiresApproval?: unknown;
    definition(prompt: string): Promise<ToolDefinition>;
    parseInput?: (args: JsonValue) => unknown;
    call(args: unknown, context?: ToolCallContext): unknown;
  } = {
    name,
    async definition(prompt: string): Promise<ToolDefinition> {
      const def = await tool.definition(prompt);
      return needsNameWrap ? { ...def, name } : def;
    },
    call(args: unknown, context?: ToolCallContext): unknown {
      if (!needsTimeoutWrap) {
        return tool.call(args, context);
      }

      return callWithTimeout(tool, name, args, context, timeoutMs);
    },
  };

  if (requiresApproval !== undefined) {
    wrapped.requiresApproval = requiresApproval;
  }

  if (tool.parseInput !== undefined) {
    const parseInput = tool.parseInput.bind(tool);
    wrapped.parseInput = (args: JsonValue) => parseInput(args);
  }

  copyPreparedToolOwner(tool, wrapped);

  if (isSkillTool(tool)) {
    markSkillTool(wrapped);
  }

  if (hasQuestionToolMarker(tool)) {
    markQuestionTool(wrapped);
  }

  return Object.freeze(wrapped);
}

async function callWithTimeout(
  tool: AnyTool,
  toolName: string,
  args: unknown,
  context: ToolCallContext | undefined,
  timeoutMs: number,
): Promise<unknown> {
  const controller = new AbortController();
  const timeoutError = new Error(`Tool "${toolName}" timed out after ${timeoutMs}ms.`);
  let timer: ReturnType<typeof setTimeout> | undefined;

  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(timeoutError);
      controller.abort(timeoutError);
    }, timeoutMs);
  });

  const combinedSignal =
    context?.abortSignal === undefined
      ? controller.signal
      : AbortSignal.any([context.abortSignal, controller.signal]);
  const callContext: ToolCallContext = {
    ...context,
    abortSignal: combinedSignal,
  };

  try {
    return await Promise.race([
      Promise.resolve().then(() => tool.call(args, callContext)),
      timeoutPromise,
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
