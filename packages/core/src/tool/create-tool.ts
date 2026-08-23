import type { z } from "zod";
import { assertToolApprovalRequirement } from "../internal/agent-runtime/approval-requirement";
import {
  attachPreparedToolOwner,
  preparedToolInput,
  withoutPreparedToolInput,
} from "../internal/agent-runtime/prepared-tool-call";
import { toProviderJsonSchema, type ZodSchema } from "../schema/zod-schema";
import type { Tool, ToolCallContext, ToolRequiresApproval } from "./tool";

export type CreateToolOptions<
  InputSchema extends ZodSchema,
  OutputSchema extends ZodSchema | undefined = undefined,
  Output = unknown,
> = {
  name: string;
  description: string;
  inputSchema: InputSchema;
  outputSchema?: OutputSchema;
  requiresApproval?: ToolRequiresApproval<z.output<InputSchema>>;
  execute(
    args: z.output<InputSchema>,
    context: ToolCallContext,
  ): OutputSchema extends ZodSchema
    ? z.input<OutputSchema> | Promise<z.input<OutputSchema>>
    : Output | Promise<Output>;
};

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
  const { name, description, inputSchema, outputSchema, execute } = options;
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
    const result = await execute(parsedArgs, executionContext);
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
