import type { AgentResponse } from "../../agent/run-types";
import type {
  CompletionRequest,
  CompletionResponse,
  Message as MessageType,
  Usage,
} from "../../completion/index";
import type { AgentHook } from "../../hooks";
import { runControl } from "../../hooks";
import type { AgentTraceOptions } from "../../observability/types";
import type { AgentMiddleware } from "../../tool/middleware";
import { assertJsonObject } from "../json-object";

export type CancelRunFn = (newMessages: MessageType[], reason: string) => Error;

export async function runRunStartHook(
  hook: AgentHook | undefined,
  args: {
    prompt: MessageType;
    history: MessageType[];
    maxTurns: number;
    newMessages: MessageType[];
    cancel: CancelRunFn;
  },
): Promise<void> {
  const action = await hook?.onRunStart?.({
    prompt: args.prompt,
    history: args.history,
    maxTurns: args.maxTurns,
    run: runControl,
  });

  if (action?.type === "terminate") {
    throw args.cancel(args.newMessages, action.reason);
  }
}

export async function runRunEndHook<Output>(
  hook: AgentHook | undefined,
  result: AgentResponse<Output>,
  newMessages: MessageType[],
  cancel: CancelRunFn,
): Promise<void> {
  const action = await hook?.onRunEnd?.({
    status: "completed",
    output: result.output,
    text: result.text,
    usage: result.usage,
    messages: result.messages,
    run: runControl,
  });

  if (action?.type === "terminate") {
    throw cancel(newMessages, action.reason);
  }
}

export async function runRunErrorHook(
  hook: AgentHook | undefined,
  args: {
    error: unknown;
    usage: Usage;
    chatHistory: MessageType[];
    newMessages: MessageType[];
    cancel: CancelRunFn;
  },
): Promise<void> {
  const action = await hook?.onRunError?.({
    error: args.error,
    usage: args.usage,
    messages: [...args.chatHistory, ...args.newMessages],
    run: runControl,
  });

  if (action?.type === "terminate") {
    args.cancel(args.newMessages, action.reason);
  }
}

export async function runTurnStartHook(
  hook: AgentHook | undefined,
  turn: number,
  prompt: MessageType,
  history: MessageType[],
  newMessages: MessageType[],
  cancel: CancelRunFn,
): Promise<void> {
  const action = await hook?.onTurnStart?.({
    turn,
    prompt,
    history,
    run: runControl,
  });

  if (action?.type === "terminate") {
    throw cancel(newMessages, action.reason);
  }
}

export async function runTurnEndHook(
  hook: AgentHook | undefined,
  turn: number,
  response: CompletionResponse,
  newMessages: MessageType[],
  cancel: CancelRunFn,
): Promise<void> {
  const action = await hook?.onTurnEnd?.({
    turn,
    response,
    run: runControl,
  });

  if (action?.type === "terminate") {
    throw cancel(newMessages, action.reason);
  }
}

export async function runCompletionCallHook(
  hook: AgentHook | undefined,
  prompt: MessageType,
  history: MessageType[],
  newMessages: MessageType[],
  cancel: CancelRunFn,
): Promise<void> {
  const action = await hook?.onCompletionCall?.({
    prompt,
    history,
    run: runControl,
  });

  if (action?.type === "terminate") {
    throw cancel(newMessages, action.reason);
  }
}

export async function runCompletionResponseHook(
  hook: AgentHook | undefined,
  prompt: MessageType,
  response: CompletionResponse,
  newMessages: MessageType[],
  cancel: CancelRunFn,
): Promise<void> {
  const action = await hook?.onCompletionResponse?.({
    prompt,
    response,
    run: runControl,
  });

  if (action?.type === "terminate") {
    throw cancel(newMessages, action.reason);
  }
}

export async function runCompletionErrorHook(
  hook: AgentHook | undefined,
  prompt: MessageType,
  error: unknown,
  newMessages: MessageType[],
  cancel: CancelRunFn,
): Promise<void> {
  const action = await hook?.onCompletionError?.({
    prompt,
    error,
    run: runControl,
  });

  if (action?.type === "terminate") {
    throw cancel(newMessages, action.reason);
  }
}

export async function runCompletionRequestMiddlewares(
  middlewares: readonly AgentMiddleware[],
  request: CompletionRequest,
  turn: number,
  defaultPromptRef: AgentTraceOptions["promptRef"],
): Promise<{
  request: CompletionRequest;
  promptRef: AgentTraceOptions["promptRef"];
}> {
  let current = request;
  let promptRef = defaultPromptRef;
  for (const middleware of middlewares) {
    const replacement = await middleware.onCompletionRequest?.({
      turn,
      request: current,
      originalRequest: request,
      promptRef,
    });

    if (replacement?.promptRef !== undefined) {
      promptRef = replacement.promptRef ?? undefined;
    }

    if (replacement?.request !== undefined) {
      current = replacement.request;

      if (current.providerOptions !== undefined) {
        assertJsonObject(current.providerOptions, "providerOptions");
      }
    }
  }
  return { request: current, promptRef };
}

export async function runCompletionResponseMiddlewares(
  middlewares: readonly AgentMiddleware[],
  request: CompletionRequest,
  response: CompletionResponse,
  turn: number,
): Promise<CompletionResponse> {
  let current = response;
  for (const middleware of middlewares) {
    const replacement = await middleware.onCompletionResponse?.({
      turn,
      request,
      response: current,
      originalResponse: response,
    });

    if (replacement?.response !== undefined) {
      current = replacement.response;
    }
  }
  return current;
}

export function shouldBufferStreamResponseEvents(
  hook: AgentHook | undefined,
  middlewares: readonly AgentMiddleware[],
): boolean {
  return (
    hook?.onCompletionResponse !== undefined ||
    middlewares.some((middleware) => middleware.onCompletionResponse !== undefined)
  );
}
