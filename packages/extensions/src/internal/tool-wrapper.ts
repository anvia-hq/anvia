import {
  type AnyTool,
  createToolkit,
  isToolkit,
  type ToolCallContext,
  type Toolkit,
} from "@anvia/core/tool";

export type ToolCallWrapper = (
  tool: AnyTool,
  args: unknown,
  context?: ToolCallContext,
) => Promise<unknown>;

export function wrapToolOrToolkit<T extends AnyTool | Toolkit>(
  target: T,
  options: {
    wrapperName: string;
    tools?: readonly string[] | undefined;
    wrapCall: ToolCallWrapper;
  },
): T {
  const wrapSingleTool = (tool: AnyTool): AnyTool => {
    const wrapped: {
      name: string;
      requiresApproval?: unknown;
      definition: AnyTool["definition"];
      parseInput?: NonNullable<AnyTool["parseInput"]>;
      call(args: unknown, context?: ToolCallContext): Promise<unknown>;
    } = {
      name: tool.name,
      definition: (prompt) => tool.definition(prompt),
      call(args: unknown, context?: ToolCallContext): Promise<unknown> {
        return options.wrapCall(tool, args, context);
      },
    };

    if (tool.requiresApproval !== undefined) {
      wrapped.requiresApproval = tool.requiresApproval;
    }

    if (tool.parseInput !== undefined) {
      const parseInput = tool.parseInput.bind(tool);
      wrapped.parseInput = (args) => parseInput(args);
    }

    copyOwnSymbols(tool, wrapped);

    return wrapped;
  };

  if (isToolkit(target)) {
    const knownNames = new Set(target.tools.map((tool) => tool.name));
    let filter: Set<string> | undefined;

    if (options.tools !== undefined) {
      for (const name of options.tools) {
        if (!knownNames.has(name)) {
          throw new TypeError(
            `Unknown tool "${name}" in ${options.wrapperName} tools option for toolkit "${target.name}".`,
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

export function copyOwnSymbols(source: object, target: object): void {
  for (const symbol of Object.getOwnPropertySymbols(source)) {
    const descriptor = Object.getOwnPropertyDescriptor(source, symbol);

    if (descriptor !== undefined) {
      Object.defineProperty(target, symbol, descriptor);
    }
  }
}
