import { cancelAgentApproval } from "../agent/agent";
import { AgentRunBlockedError } from "../agent/errors";
import type {
  AgentApprovalRequiredResult,
  AgentResponse,
  AgentResult,
  AgentRunOptions,
} from "../agent/run-types";
import type { EvalCase, EvalTarget } from "./types";

type EvaluableAgent<Output> = {
  generate(input: AgentRunOptions<Output>): Promise<AgentResult<Output>>;
};

type IsAny<Value> = 0 extends 1 & Value ? true : false;
type IsExactly<Left, Right> =
  IsAny<Left> extends true
    ? false
    : [Left] extends [Right]
      ? [Right] extends [Left]
        ? true
        : false
      : false;

export type AgentEvalTargetOptions<
  Input,
  AgentOutput = string,
  Output = AgentResponse<AgentOutput>,
  Expected = unknown,
> = {
  agent: EvaluableAgent<AgentOutput>;
  request(args: {
    input: Input;
    testCase: EvalCase<Input, Expected>;
  }): AgentRunOptions<AgentOutput> | Promise<AgentRunOptions<AgentOutput>>;
} & (IsExactly<Output, AgentResponse<AgentOutput>> extends true
  ? {
      output?(args: {
        response: AgentResponse<AgentOutput>;
        testCase: EvalCase<Input, Expected>;
      }): Output | Promise<Output>;
    }
  : {
      output(args: {
        response: AgentResponse<AgentOutput>;
        testCase: EvalCase<Input, Expected>;
      }): Output | Promise<Output>;
    });

export class AgentEvalApprovalError extends Error {
  constructor(readonly result: AgentApprovalRequiredResult) {
    super("Agent eval targets cannot suspend for tool approval.");
    this.name = "AgentEvalApprovalError";
  }
}

export function agentEvalTarget<
  Input,
  AgentOutput = string,
  Output = AgentResponse<AgentOutput>,
  Expected = unknown,
>(
  options: AgentEvalTargetOptions<Input, AgentOutput, Output, Expected>,
): EvalTarget<Input, Output, Expected> {
  return async (input, testCase) => {
    const request = await options.request({ input, testCase });
    const response = await options.agent.generate(request);
    if (response.status === "approval_required") {
      await cancelAgentApproval(response, "Agent eval targets cannot suspend for tool approval.");
      throw new AgentEvalApprovalError(response);
    }
    if (response.status === "blocked") throw new AgentRunBlockedError(response);
    return options.output === undefined
      ? (response as Output)
      : await options.output({ response, testCase });
  };
}
