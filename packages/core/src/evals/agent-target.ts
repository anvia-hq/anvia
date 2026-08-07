import type { Agent } from "../agent/agent";
import type { Message } from "../completion";
import type { PromptResponse } from "../request/types";
import type { EvalCase, EvalTarget } from "./types";

export type AgentEvalTargetOptions<Input, Output = PromptResponse, Expected = unknown> = {
  prompt?: ((input: Input, testCase: EvalCase<Input, Expected>) => string | Message) | undefined;
  output?: ((response: PromptResponse, testCase: EvalCase<Input, Expected>) => Output) | undefined;
};

export function agentEvalTarget<Input, Expected = unknown>(
  agent: Agent,
  options?: AgentEvalTargetOptions<Input, PromptResponse, Expected>,
): EvalTarget<Input, PromptResponse, Expected>;
export function agentEvalTarget<Input, Output, Expected = unknown>(
  agent: Agent,
  options: AgentEvalTargetOptions<Input, Output, Expected>,
): EvalTarget<Input, Output, Expected>;
export function agentEvalTarget<Input, Output, Expected>(
  agent: Agent,
  options: AgentEvalTargetOptions<Input, Output | PromptResponse, Expected> = {},
): EvalTarget<Input, Output | PromptResponse, Expected> {
  return async (input, testCase) => {
    const prompt = options.prompt?.(input, testCase) ?? String(input);
    const response = await agent.prompt(prompt).send();
    return options.output === undefined ? response : options.output(response, testCase);
  };
}
