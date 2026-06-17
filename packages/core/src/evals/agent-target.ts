import type { Agent } from "../agent/agent";
import type { PromptResponse } from "../agent/request-types";
import type { Message } from "../completion";
import type { EvalCase, EvalTarget } from "./types";

export type AgentEvalTargetOptions<Input, Output = PromptResponse> = {
  prompt?: ((input: Input, testCase: EvalCase<Input>) => string | Message) | undefined;
  output?: ((response: PromptResponse, testCase: EvalCase<Input>) => Output) | undefined;
};

export function agentEvalTarget<Input>(
  agent: Agent,
  options?: AgentEvalTargetOptions<Input, PromptResponse>,
): EvalTarget<Input, PromptResponse>;
export function agentEvalTarget<Input, Output>(
  agent: Agent,
  options: AgentEvalTargetOptions<Input, Output>,
): EvalTarget<Input, Output>;
export function agentEvalTarget<Input, Output>(
  agent: Agent,
  options: AgentEvalTargetOptions<Input, Output | PromptResponse> = {},
): EvalTarget<Input, Output | PromptResponse> {
  return async (input, testCase) => {
    const prompt = options.prompt?.(input, testCase) ?? String(input);
    const response = await agent.prompt(prompt).send();
    return options.output === undefined ? response : options.output(response, testCase);
  };
}
