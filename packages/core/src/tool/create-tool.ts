import type { z } from "zod";
import { toProviderJsonSchema, type ZodSchema } from "../schema/zod-schema";
import type { Tool, ToolApprovalPolicy } from "./tool";

export type CreateToolOptions<
  InputSchema extends ZodSchema,
  OutputSchema extends ZodSchema | undefined = undefined,
> = {
  name: string;
  description: string;
  input: InputSchema;
  output?: OutputSchema;
  approval?: ToolApprovalPolicy<z.output<InputSchema>>;
  execute(
    args: z.output<InputSchema>,
  ): OutputSchema extends ZodSchema
    ? z.input<OutputSchema> | Promise<z.input<OutputSchema>>
    : unknown | Promise<unknown>;
};

type ToolOutput<OutputSchema extends ZodSchema | undefined> = OutputSchema extends ZodSchema
  ? z.output<OutputSchema>
  : unknown;

export function createTool<
  InputSchema extends ZodSchema,
  OutputSchema extends ZodSchema | undefined = undefined,
>(
  options: CreateToolOptions<InputSchema, OutputSchema>,
): Tool<z.output<InputSchema>, ToolOutput<OutputSchema>> {
  const parameters = toProviderJsonSchema(options.input);

  return {
    name: options.name,
    ...(options.approval === undefined ? {} : { approval: options.approval }),
    definition() {
      return {
        name: options.name,
        description: options.description,
        parameters,
      };
    },
    async call(args): Promise<ToolOutput<OutputSchema>> {
      const parsedArgs = options.input.parse(args);
      const result = await options.execute(parsedArgs);
      return (
        options.output === undefined ? result : options.output.parse(result)
      ) as ToolOutput<OutputSchema>;
    },
    parseApprovalArgs(args): z.output<InputSchema> {
      return options.input.parse(args);
    },
  };
}
