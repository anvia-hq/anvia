import { AgentRunBlockedError } from "../agent/errors";
import type { AgentInteractionRequest, AgentInteractionResponse } from "../agent/interactions";
import type {
  AgentInteractionOutcome,
  AgentOutcome,
  AgentResponse,
  AgentRunOptions,
  AgentRunSettings,
} from "../agent/run-types";
import type { EvalCase, EvalTarget } from "./types";

type EvaluableAgent<Output> = {
  generate(input: AgentRunOptions<Output>): Promise<AgentOutcome<Output>>;
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
  interactions?:
    | {
        maxResponses?: number | undefined;
        respond(args: {
          interaction: AgentInteractionRequest;
          testCase: EvalCase<Input, Expected>;
          phase: number;
        }): AgentInteractionResponse | Promise<AgentInteractionResponse>;
      }
    | undefined;
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

export class AgentEvalSuspensionError extends Error {
  constructor(
    readonly result: AgentInteractionOutcome,
    message = "Agent eval target suspended without an interaction responder.",
  ) {
    super(message);
    this.name = "AgentEvalSuspensionError";
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
    const maxResponses = options.interactions?.maxResponses ?? 10;
    if (!Number.isSafeInteger(maxResponses) || maxResponses < 1) {
      throw new TypeError("Agent eval interactions.maxResponses must be a positive integer.");
    }
    const request = await options.request({ input, testCase });
    const runSettings = agentRunSettings(request);
    let response = await options.agent.generate(request);
    let phase = 0;
    while (response.type === "interaction") {
      if (options.interactions === undefined) {
        throw new AgentEvalSuspensionError(response);
      }
      if (phase >= maxResponses) {
        throw new AgentEvalSuspensionError(
          response,
          `Agent eval target exceeded the interaction response limit of ${maxResponses}.`,
        );
      }
      phase += 1;
      const interactionResponse = await options.interactions.respond({
        interaction: response.interaction,
        testCase,
        phase,
      });
      response = await options.agent.generate({
        continuation: response.continuation,
        response: interactionResponse,
        ...runSettings,
      });
    }
    if (response.type === "blocked") throw new AgentRunBlockedError(response);
    return options.output === undefined
      ? (response as Output)
      : await options.output({ response, testCase });
  };
}

function agentRunSettings<Output>(request: AgentRunOptions<Output>): AgentRunSettings<Output> {
  const {
    prompt: _prompt,
    messages: _messages,
    session: _session,
    continuation: _continuation,
    response: _response,
    ...settings
  } = request;
  return settings;
}
