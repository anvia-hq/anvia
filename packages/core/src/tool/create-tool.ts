import type { z } from "zod";
import { compact } from "../internal/compact";
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

  return {
    ...compact({ name: options.name, approval: options.approval }),
    definition() {
      return {
        name: options.name,
        description: options.description,
        parameters,
      };
    },
    async call(args, context = {}): Promise<CreateToolOutput<OutputSchema, Output>> {
      const parsedArgs = options.input.parse(args);
      const result = await options.execute(parsedArgs, context);
      return (
        options.output === undefined ? result : options.output.parse(result)
      ) as CreateToolOutput<OutputSchema, Output>;
    },
    parseApprovalArgs(args): z.output<InputSchema> {
      return options.input.parse(args);
    },
  };
}
