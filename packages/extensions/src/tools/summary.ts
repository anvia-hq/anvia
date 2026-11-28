import type { JsonObject, JsonValue, ToolDefinition } from "@anvia/core/completion";
import {
  type AnyTool,
  createToolkit,
  isToolkit,
  type ToolCallContext,
  type Toolkit,
  type ToolRequiresApproval,
} from "@anvia/core/tool";

export type ToolSummaryEvent = {
  toolName: string;
  summary: string;
  args: unknown;
  context?: ToolCallContext | undefined;
};

export type ToolSummaryOptions = {
  /** Input parameter name injected into the tool schema. Default `"summary"`. */
  field?: string | undefined;
  /** Schema description instructing the model how to write the summary label. */
  description?: string | undefined;
  /** Whether the summary field is required in the tool schema. Default true. */
  required?: boolean | undefined;
  /** Optional allowlist of tool names to wrap when targeting a Toolkit. */
  tools?: readonly string[] | undefined;
  /** Optional callback invoked with the extracted summary right before executing the tool. */
  onSummary?: ((event: ToolSummaryEvent) => void | Promise<void>) | undefined;
};

const DEFAULT_FIELD = "summary";
const DEFAULT_DESCRIPTION =
  "Brief 2-6 word human-readable label describing what this tool call is doing (e.g. 'Check git status', 'Search API docs').";
const FORBIDDEN_FIELDS = new Set(["__proto__", "constructor", "prototype"]);

const QUESTION_TOOL_SYMBOL = Symbol.for("anvia.question.tool");
const SKILL_TOOL_SYMBOL = Symbol.for("anvia.skill.tool");

type SchemaOwnershipState = {
  alreadyPresent: boolean;
  injected: boolean;
};

type PreparedSummaryMeta = {
  summary: string | undefined;
  parsedInner: unknown;
  rawInner: unknown;
  passThrough: boolean;
};

export function withToolSummary<T extends AnyTool | Toolkit>(
  target: T,
  options: ToolSummaryOptions = {},
): T {
  const field = (options.field ?? DEFAULT_FIELD).trim();

  if (field.length === 0 || FORBIDDEN_FIELDS.has(field)) {
    throw new TypeError(`withToolSummary field "${options.field ?? ""}" is invalid.`);
  }

  const description = (options.description ?? DEFAULT_DESCRIPTION).trim();

  if (description.length === 0) {
    throw new TypeError("withToolSummary description must not be empty.");
  }

  const required = options.required ?? true;

  const wrapSingleTool = (tool: AnyTool): AnyTool => {
    let schemaState: SchemaOwnershipState | undefined;
    let schemaProbePromise: Promise<SchemaOwnershipState> | undefined;
    const preparedMeta = new WeakMap<object, PreparedSummaryMeta>();

    const inspectSync = (): SchemaOwnershipState | undefined => {
      if (schemaState !== undefined) return schemaState;

      try {
        const result = tool.definition("");

        if (isPromiseLike(result)) {
          schemaProbePromise ??= Promise.resolve(result).then((def) => {
            const inspected = injectSummaryIntoDefinition(def, field, description, required);
            schemaState = {
              alreadyPresent: inspected.alreadyPresent,
              injected: inspected.injected,
            };
            return schemaState;
          });
          return undefined;
        }

        const inspected = injectSummaryIntoDefinition(result, field, description, required);
        schemaState = {
          alreadyPresent: inspected.alreadyPresent,
          injected: inspected.injected,
        };
        return schemaState;
      } catch {
        return undefined;
      }
    };

    const ensureSchemaState = async (): Promise<SchemaOwnershipState> => {
      const syncState = inspectSync();

      if (syncState !== undefined) return syncState;

      schemaProbePromise ??= Promise.resolve(tool.definition("")).then((def) => {
        const inspected = injectSummaryIntoDefinition(def, field, description, required);
        schemaState = {
          alreadyPresent: inspected.alreadyPresent,
          injected: inspected.injected,
        };
        return schemaState;
      });

      return await schemaProbePromise;
    };

    const wrapped: {
      name: string;
      requiresApproval?: ToolRequiresApproval<unknown>;
      definition: AnyTool["definition"];
      parseInput: NonNullable<AnyTool["parseInput"]>;
      call(args: unknown, context?: ToolCallContext): Promise<unknown>;
    } = {
      name: tool.name,
      async definition(prompt: string): Promise<ToolDefinition> {
        const def = await tool.definition(prompt);
        const result = injectSummaryIntoDefinition(def, field, description, required);
        schemaState = {
          alreadyPresent: result.alreadyPresent,
          injected: result.injected,
        };
        return result.definition;
      },
      parseInput(rawArgs: JsonValue): unknown {
        const currentState = inspectSync();

        if (!isPlainObject(rawArgs)) {
          return tool.parseInput === undefined ? rawArgs : tool.parseInput(rawArgs);
        }

        if (currentState !== undefined && (currentState.alreadyPresent || !currentState.injected)) {
          return tool.parseInput === undefined ? rawArgs : tool.parseInput(rawArgs);
        }

        const rawSummary = rawArgs[field];

        if (
          currentState === undefined &&
          tool.parseInput !== undefined &&
          rawSummary !== undefined
        ) {
          const strippedCandidate = stripField(rawArgs, field) as JsonObject;
          let strippedFailed = false;
          try {
            tool.parseInput(strippedCandidate);
          } catch {
            strippedFailed = true;
          }

          if (strippedFailed) {
            try {
              return tool.parseInput(rawArgs);
            } catch {
              strippedFailed = false;
            }
          }
        }

        let summaryValue: string | undefined;

        if (rawSummary !== undefined) {
          if (typeof rawSummary !== "string") {
            throw new TypeError(`Tool "${tool.name}" field "${field}" must be a string.`);
          }

          const trimmed = rawSummary.trim();

          if (required && trimmed.length === 0) {
            throw new TypeError(`Tool "${tool.name}" field "${field}" must not be empty.`);
          }

          if (trimmed.length > 0) {
            summaryValue = trimmed;
          }
        } else if (required) {
          throw new TypeError(`Tool "${tool.name}" requires a "${field}" string.`);
        }

        const innerInput = stripField(rawArgs, field) as JsonObject;
        const parsedInner =
          tool.parseInput === undefined ? innerInput : tool.parseInput(innerInput);

        if (isPlainObject(parsedInner)) {
          const out: Record<string, unknown> =
            summaryValue !== undefined
              ? { ...parsedInner, [field]: summaryValue }
              : { ...parsedInner };
          preparedMeta.set(out, {
            summary: summaryValue,
            parsedInner,
            rawInner: innerInput,
            passThrough: false,
          });
          return out;
        }

        if (typeof parsedInner === "object" && parsedInner !== null) {
          preparedMeta.set(parsedInner, {
            summary: summaryValue,
            parsedInner,
            rawInner: innerInput,
            passThrough: false,
          });
        }

        return parsedInner;
      },
      async call(args: unknown, context?: ToolCallContext): Promise<unknown> {
        const meta = typeof args === "object" && args !== null ? preparedMeta.get(args) : undefined;

        if (meta !== undefined && !meta.passThrough) {
          if (meta.summary !== undefined && options.onSummary !== undefined) {
            const event: ToolSummaryEvent = {
              toolName: tool.name,
              summary: meta.summary,
              args: meta.parsedInner,
            };

            if (context !== undefined) event.context = context;

            await options.onSummary(event);
          }

          const callArgs = tool.parseInput !== undefined ? meta.rawInner : meta.parsedInner;
          return await tool.call(callArgs, context);
        }

        const state = await ensureSchemaState();

        if (state.alreadyPresent || !state.injected) {
          return await tool.call(args, context);
        }

        let summary: string | undefined;
        let forwardArgs: unknown = args;

        if (isPlainObject(args) && Object.hasOwn(args, field)) {
          const candidate = args[field];

          if (typeof candidate === "string" && candidate.trim().length > 0) {
            summary = candidate.trim();
          }

          forwardArgs = stripField(args, field);
        }

        if (summary !== undefined && options.onSummary !== undefined) {
          const event: ToolSummaryEvent = {
            toolName: tool.name,
            summary,
            args: forwardArgs,
          };

          if (context !== undefined) event.context = context;

          await options.onSummary(event);
        }

        return await tool.call(forwardArgs, context);
      },
    };

    if (tool.requiresApproval !== undefined) {
      if (typeof tool.requiresApproval === "function") {
        const innerPredicate = tool.requiresApproval;
        wrapped.requiresApproval = (approvalArgs, approvalContext) => {
          const meta =
            typeof approvalArgs === "object" && approvalArgs !== null
              ? preparedMeta.get(approvalArgs)
              : undefined;
          let cleanArgs = approvalArgs;

          if (meta !== undefined && !meta.passThrough) {
            cleanArgs = meta.parsedInner;
          } else if (
            schemaState !== undefined &&
            !schemaState.alreadyPresent &&
            schemaState.injected &&
            isPlainObject(approvalArgs)
          ) {
            cleanArgs = stripField(approvalArgs, field);
          }

          return innerPredicate(cleanArgs, {
            ...approvalContext,
            args: cleanArgs,
          });
        };
      } else {
        wrapped.requiresApproval = tool.requiresApproval as ToolRequiresApproval<unknown>;
      }
    }

    const sourceRecord = tool as unknown as Record<PropertyKey, unknown>;

    if (sourceRecord[QUESTION_TOOL_SYMBOL] === true) {
      Object.defineProperty(wrapped, QUESTION_TOOL_SYMBOL, { value: true });
    }

    if (sourceRecord[SKILL_TOOL_SYMBOL] === true) {
      Object.defineProperty(wrapped, SKILL_TOOL_SYMBOL, { value: true });
    }

    return wrapped;
  };

  if (isToolkit(target)) {
    const knownNames = new Set(target.tools.map((tool) => tool.name));
    let filter: Set<string> | undefined;

    if (options.tools !== undefined) {
      for (const name of options.tools) {
        if (!knownNames.has(name)) {
          throw new TypeError(
            `Unknown tool "${name}" in withToolSummary tools option for toolkit "${target.name}".`,
          );
        }
      }

      filter = new Set(options.tools);
    }

    const wrappedTools = target.tools.map((tool) =>
      filter === undefined || filter.has(tool.name) ? wrapSingleTool(tool) : tool,
    );
    return createToolkit({
      name: target.name,
      tools: wrappedTools,
      instructions: target.instructions,
    }) as T;
  }

  return wrapSingleTool(target) as T;
}

function injectSummaryIntoDefinition(
  definition: ToolDefinition,
  field: string,
  description: string,
  required: boolean,
): { definition: ToolDefinition; alreadyPresent: boolean; injected: boolean } {
  const params = definition.parameters;

  if (!isInjectableObjectSchema(params)) {
    return { definition, alreadyPresent: false, injected: false };
  }

  const rawProperties = params.properties;
  const existingProperties: JsonObject = isPlainObject(rawProperties) ? { ...rawProperties } : {};

  if (Object.hasOwn(existingProperties, field)) {
    return { definition, alreadyPresent: true, injected: false };
  }

  existingProperties[field] = {
    type: "string",
    description,
  };

  const nextParams: JsonObject = {
    ...params,
    type: "object",
    properties: existingProperties,
  };

  if (required) {
    const existingRequired = Array.isArray(params.required)
      ? params.required.filter((item): item is string => typeof item === "string")
      : [];

    if (!existingRequired.includes(field)) {
      nextParams.required = [...existingRequired, field];
    }
  }

  return {
    definition: {
      ...definition,
      parameters: nextParams,
    },
    alreadyPresent: false,
    injected: true,
  };
}

function isInjectableObjectSchema(params: unknown): params is JsonObject {
  if (!isPlainObject(params)) return false;

  if (Array.isArray(params.anyOf) || Array.isArray(params.oneOf) || Array.isArray(params.allOf)) {
    return false;
  }

  return (
    params.type === "object" || (params.type === undefined && isPlainObject(params.properties))
  );
}

function isPromiseLike<T>(value: T | Promise<T>): value is Promise<T> {
  return (
    typeof value === "object" &&
    value !== null &&
    "then" in value &&
    typeof (value as { then?: unknown }).then === "function"
  );
}

function stripField(obj: Record<string, unknown>, field: string): Record<string, unknown> {
  const next: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(obj)) {
    if (key !== field) {
      next[key] = value;
    }
  }

  return next;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}
