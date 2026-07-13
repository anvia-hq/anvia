import type { z } from "zod";
import { toProviderJsonSchema, type ZodSchema } from "../schema/zod-schema";
import type { Tool, ToolApprovalPolicy, ToolCallContext } from "./tool";

export type CreateToolOptions<
  InputSchema extends ZodSchema,
  OutputSchema extends ZodSchema | undefined = undefined,
  Output = unknown,
> = {
  name: string;
  description: string;
  input: InputSchema;
  output?: OutputSchema;
  approval?: ToolApprovalPolicy<z.output<InputSchema>>;
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
  options: CreateToolOptions<InputSchema, undefined, Output> & { output?: undefined },
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
  const parameters = toProviderJsonSchema(options.input);
  const definition = () => ({
    name: options.name,
    description: options.description,
    parameters,
  });
  const call = async (
    args: z.output<InputSchema>,
    context: ToolCallContext = {},
  ): Promise<CreateToolOutput<OutputSchema, Output>> => {
    const parsedArgs = options.input.parse(args);
    const result = await options.execute(parsedArgs, context);
    return (
      options.output === undefined ? result : options.output.parse(result)
    ) as CreateToolOutput<OutputSchema, Output>;
  };
  const parseApprovalArgs = (args: unknown): z.output<InputSchema> => options.input.parse(args);

  if (options.approval === undefined) {
    return { name: options.name, definition, call, parseApprovalArgs };
  }
  return {
    name: options.name,
    approval: options.approval,
    definition,
    call,
    parseApprovalArgs,
  };
}
