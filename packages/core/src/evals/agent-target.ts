import { cancelAgentApproval } from "../agent/agent";
import { AgentRunBlockedError } from "../agent/errors";
import type { AgentInput, AgentResponse, AgentResult } from "../agent/run-types";
import type { Message } from "../completion";
import type { EvalCase, EvalTarget } from "./types";

export type AgentEvalTargetOptions<
  Input,
  AgentOutput = string,
  Output = AgentResponse<AgentOutput>,
  Expected = unknown,
> = {
  prompt?: ((input: Input, testCase: EvalCase<Input, Expected>) => string | Message) | undefined;
  output?:
    | ((response: AgentResponse<AgentOutput>, testCase: EvalCase<Input, Expected>) => Output)
    | undefined;
};

type EvaluableAgent<Output> = {
  generate(input: AgentInput): Promise<AgentResult<Output>>;
};

export function agentEvalTarget<Input, AgentOutput = string, Expected = unknown>(
  agent: EvaluableAgent<AgentOutput>,
  options?: AgentEvalTargetOptions<Input, AgentOutput, AgentResponse<AgentOutput>, Expected>,
): EvalTarget<Input, AgentResponse<AgentOutput>, Expected>;
export function agentEvalTarget<Input, AgentOutput, Output, Expected = unknown>(
  agent: EvaluableAgent<AgentOutput>,
  options: AgentEvalTargetOptions<Input, AgentOutput, Output, Expected>,
): EvalTarget<Input, Output, Expected>;
export function agentEvalTarget<Input, AgentOutput, Output, Expected>(
  agent: EvaluableAgent<AgentOutput>,
  options: AgentEvalTargetOptions<
    Input,
    AgentOutput,
    Output | AgentResponse<AgentOutput>,
    Expected
  > = {},
): EvalTarget<Input, Output | AgentResponse<AgentOutput>, Expected> {
  return async (input, testCase) => {
    const prompt = options.prompt?.(input, testCase) ?? String(input);
    const response = await agent.generate(
      typeof prompt === "string" ? { prompt } : { messages: [prompt] },
    );
    if (response.status === "approval_required") {
      await cancelAgentApproval(response, "Agent eval targets cannot suspend for tool approval.");
      throw new Error("Agent eval targets cannot suspend for tool approval.");
    }
    if (response.status === "blocked") {
      throw new AgentRunBlockedError(response);
    }
    return options.output === undefined ? response : options.output(response, testCase);
  };
}
