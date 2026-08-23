import { ToolCallError, ToolJsonError } from "../../tool/errors";
import {
  type AnyTool,
  type NormalizedToolOutput,
  normalizeToolResultOutput,
  parseToolArgs,
  type ToolCallContext,
} from "../../tool/tool";

const preparedToolInputSymbol = Symbol("preparedToolInput");
const preparedToolOwnerSymbol = Symbol("preparedToolOwner");

export type PreparedToolCall = {
  input: unknown;
  call(context: ToolCallContext): Promise<NormalizedToolOutput>;
};

type PreparedToolCallContext = ToolCallContext & {
  [preparedToolInputSymbol]?: { owner: object; input: unknown };
};

type ToolWithPreparedOwner = AnyTool & {
  [preparedToolOwnerSymbol]?: object;
};

export function attachPreparedToolOwner<T extends AnyTool>(tool: T, owner: object): T {
  Object.defineProperty(tool, preparedToolOwnerSymbol, {
    configurable: false,
    enumerable: true,
    value: owner,
    writable: false,
  });
  return tool;
}

export function preparedToolInput(
  context: ToolCallContext | undefined,
  owner: object,
): { input: unknown } | undefined {
  if (context === undefined || !(preparedToolInputSymbol in context)) {
    return undefined;
  }
  const prepared = (context as PreparedToolCallContext)[preparedToolInputSymbol];
  return prepared?.owner === owner ? { input: prepared.input } : undefined;
}

export function withoutPreparedToolInput(context: ToolCallContext): ToolCallContext {
  if (!(preparedToolInputSymbol in context)) {
    return context;
  }
  const { [preparedToolInputSymbol]: _prepared, ...publicContext } =
    context as PreparedToolCallContext;
  return publicContext;
}

export function prepareToolCall(tool: AnyTool, args: string): PreparedToolCall {
  let rawInput: ReturnType<typeof parseToolArgs>;
  try {
    rawInput = parseToolArgs(args);
  } catch (error) {
    throw new ToolJsonError(`Invalid JSON arguments for tool ${tool.name}`, error);
  }

  let input: unknown;
  try {
    input = tool.parseInput === undefined ? rawInput : tool.parseInput(rawInput);
  } catch (error) {
    throw asToolCallError(tool.name, error);
  }

  return prepareToolCallFromInput(tool, input);
}

export function prepareToolCallFromInput(tool: AnyTool, input: unknown): PreparedToolCall {
  return {
    input,
    async call(context) {
      try {
        const owner = (tool as ToolWithPreparedOwner)[preparedToolOwnerSymbol];
        return normalizeToolResultOutput(
          await tool.call(
            input,
            owner === undefined ? context : withPreparedToolInput(context, owner, input),
          ),
        );
      } catch (error) {
        throw asToolCallError(tool.name, error);
      }
    },
  };
}

function withPreparedToolInput(
  context: ToolCallContext,
  owner: object,
  input: unknown,
): ToolCallContext {
  const preparedContext: PreparedToolCallContext = { ...context };
  Object.defineProperty(preparedContext, preparedToolInputSymbol, {
    configurable: false,
    enumerable: true,
    value: { owner, input },
    writable: false,
  });
  return preparedContext;
}

function asToolCallError(toolName: string, error: unknown): ToolCallError {
  if (error instanceof ToolCallError) {
    return error;
  }
  return error instanceof Error
    ? new ToolCallError(error.message, error)
    : new ToolCallError(`Tool ${toolName} failed`, error);
}
