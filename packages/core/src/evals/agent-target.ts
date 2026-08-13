import type { Agent } from "../agent/agent";
import type { AgentResponse } from "../agent/run-types";
import type { Message } from "../completion";
import type { EvalCase, EvalTarget } from "./types";

export type AgentEvalTargetOptions<Input, Output = AgentResponse, Expected = unknown> = {
  prompt?: ((input: Input, testCase: EvalCase<Input, Expected>) => string | Message) | undefined;
  output?: ((response: AgentResponse, testCase: EvalCase<Input, Expected>) => Output) | undefined;
};

export function agentEvalTarget<Input, Expected = unknown>(
  agent: Agent,
  options?: AgentEvalTargetOptions<Input, AgentResponse, Expected>,
): EvalTarget<Input, AgentResponse, Expected>;
export function agentEvalTarget<Input, Output, Expected = unknown>(
  agent: Agent,
  options: AgentEvalTargetOptions<Input, Output, Expected>,
): EvalTarget<Input, Output, Expected>;
export function agentEvalTarget<Input, Output, Expected>(
  agent: Agent,
  options: AgentEvalTargetOptions<Input, Output | AgentResponse, Expected> = {},
): EvalTarget<Input, Output | AgentResponse, Expected> {
  return async (input, testCase) => {
    const prompt = options.prompt?.(input, testCase) ?? String(input);
    const response = await agent.generate(prompt);
    return options.output === undefined ? response : options.output(response, testCase);
  };
}
