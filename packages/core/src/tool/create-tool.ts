import type { z } from "zod";
import { assertToolApprovalRequirement } from "../internal/agent-runtime/approval-requirement";
import {
  attachPreparedToolOwner,
  preparedToolInput,
  withoutPreparedToolInput,
} from "../internal/agent-runtime/prepared-tool-call";
import { toProviderJsonSchema, type ZodSchema } from "../schema/zod-schema";
import type { Tool, ToolCallContext, ToolRequiresApproval } from "./tool";

type CreateToolResult<
  OutputSchema extends ZodSchema | undefined,
  Output,
> = OutputSchema extends ZodSchema
  ? z.input<OutputSchema> | Promise<z.input<OutputSchema>>
  : Output | Promise<Output>;

type CreateToolBaseOptions<
  InputSchema extends ZodSchema,
  OutputSchema extends ZodSchema | undefined,
> = {
  name: string;
  description: string;
  inputSchema: InputSchema;
  outputSchema?: OutputSchema;
  requiresApproval?: ToolRequiresApproval<z.output<InputSchema>>;
};

/**
 * Pass exactly one of `handler` or the deprecated `execute`. They have the same signature, so
 * migrating is a rename.
 */
export type CreateToolOptions<
  InputSchema extends ZodSchema,
  OutputSchema extends ZodSchema | undefined = undefined,
  Output = unknown,
> = CreateToolBaseOptions<InputSchema, OutputSchema> &
  (
    | {
        /** Runs the tool with the validated input. */
        handler(
          args: z.output<InputSchema>,
          context: ToolCallContext,
        ): CreateToolResult<OutputSchema, Output>;
        execute?: never;
      }
    | {
        /**
         * @deprecated Use `handler`, which has the same signature. `execute` will be removed in
         * the next major release.
         */
        execute(
          args: z.output<InputSchema>,
          context: ToolCallContext,
        ): CreateToolResult<OutputSchema, Output>;
        handler?: never;
      }
  );

type CreateToolOutput<
  OutputSchema extends ZodSchema | undefined,
  Output,
> = OutputSchema extends ZodSchema ? z.output<OutputSchema> : Output;

export function createTool<InputSchema extends ZodSchema, Output = unknown>(
  options: CreateToolOptions<InputSchema, undefined, Output> & { outputSchema?: undefined },
): Tool<z.output<InputSchema>, Output>;

export function createTool<InputSchema extends ZodSchema, OutputSchema extends ZodSchema>(
  options: CreateToolOptions<InputSchema, OutputSchema>,
): Tool<z.output<InputSchema>, z.output<OutputSchema>>;

export function createTool<
  InputSchema extends ZodSchema,
  OutputSchema extends ZodSchema | undefined = undefined,
  Output = unknown,
>(
  options: CreateToolOptions<InputSchema, OutputSchema, Output>,
): Tool<z.output<InputSchema>, CreateToolOutput<OutputSchema, Output>> {
  const { name, description, inputSchema, outputSchema } = options;
  const run = resolveHandler(name, options);
  const requiresApproval = snapshotApprovalRequirement(options.requiresApproval);
  if (requiresApproval !== undefined) {
    assertToolApprovalRequirement(requiresApproval, { allowFunction: true });
  }
  const parameters = toProviderJsonSchema(inputSchema);
  const preparedInputOwner = {};
  const definition = () => ({
    name,
    description,
    parameters: globalThis.structuredClone(parameters),
  });
  const call = async (
    args: z.output<InputSchema>,
    context: ToolCallContext = {},
  ): Promise<CreateToolOutput<OutputSchema, Output>> => {
    const prepared = preparedToolInput(context, preparedInputOwner);
    const parsedArgs =
      prepared === undefined ? inputSchema.parse(args) : (prepared.input as z.output<InputSchema>);
    const executionContext = prepared === undefined ? context : withoutPreparedToolInput(context);
    const result = await run(parsedArgs, executionContext);
    return (outputSchema === undefined ? result : outputSchema.parse(result)) as CreateToolOutput<
      OutputSchema,
      Output
    >;
  };
  const parseInput = (args: unknown): z.output<InputSchema> => inputSchema.parse(args);

  const tool: Tool<z.output<InputSchema>, CreateToolOutput<OutputSchema, Output>> = {
    name,
    definition,
    call,
    parseInput,
  };
  if (requiresApproval !== undefined) {
    Object.defineProperty(tool, "requiresApproval", {
      configurable: false,
      enumerable: true,
      value: requiresApproval,
      writable: false,
    });
  }
  return attachPreparedToolOwner(tool, preparedInputOwner);
}

function snapshotApprovalRequirement<Args>(
  requirement: ToolRequiresApproval<Args> | undefined,
): ToolRequiresApproval<Args> | undefined {
  return typeof requirement === "object" && requirement !== null
    ? Object.freeze({ ...requirement })
    : requirement;
}

function resolveHandler<Args, Context, Result>(
  name: string,
  options: { handler?: unknown; execute?: unknown },
): (args: Args, context: Context) => Result {
  const { handler, execute } = options;
  if (handler !== undefined && execute !== undefined) {
    throw new TypeError(
      `Tool "${name}" sets both "handler" and "execute". Use "handler"; "execute" is deprecated.`,
    );
  }
  const run = handler ?? execute;
  if (typeof run !== "function") {
    throw new TypeError(`Tool "${name}" requires a "handler" function.`);
  }
  return run as (args: Args, context: Context) => Result;
}
