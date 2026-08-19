import type {
  CompletionRequest,
  CompletionResponse,
  JsonValue,
  ToolResultContentPart,
} from "../completion";
import type { MaybePromise } from "../internal/type-utils";

export type CompletionRequestMiddlewareArgs = {
  turn: number;
  request: CompletionRequest;
  originalRequest: CompletionRequest;
};

export type CompletionRequestMiddlewareResult =
  | {
      request: CompletionRequest;
    }
  | undefined;

export type CompletionResponseMiddlewareArgs<RawResponse = unknown> = {
  turn: number;
  request: CompletionRequest;
  response: CompletionResponse<RawResponse>;
  originalResponse: CompletionResponse<RawResponse>;
};

export type CompletionResponseMiddlewareResult<RawResponse = unknown> =
  | {
      response: CompletionResponse<RawResponse>;
    }
  | undefined;

export type ToolInputMiddlewareArgs = {
  toolName: string;
  args: string;
  originalArgs: string;
  turn: number;
  toolCallId?: string | undefined;
  internalCallId: string;
};

export type ToolInputMiddlewareResult =
  | {
      args: JsonValue | string;
    }
  | undefined;

export type ToolResultMiddlewareArgs = {
  toolName: string;
  args: string;
  result: string;
  originalResult: string;
  structuredResult?: readonly ToolResultContentPart[] | undefined;
  originalStructuredResult?: readonly ToolResultContentPart[] | undefined;
  turn: number;
  toolCallId?: string | undefined;
  internalCallId: string;
};

export type ToolOutputMiddlewareArgs = ToolResultMiddlewareArgs;

export type ToolOutputMiddlewareResult =
  | string
  | Readonly<{ result: string; structuredResult?: never }>
  | Readonly<{
      structuredResult: readonly ToolResultContentPart[];
      result?: never;
    }>
  | undefined;

export interface AgentMiddleware<RawResponse = unknown> {
  onCompletionRequest?(
    args: CompletionRequestMiddlewareArgs,
  ): MaybePromise<CompletionRequestMiddlewareResult>;
  onCompletionResponse?(
    args: CompletionResponseMiddlewareArgs<RawResponse>,
  ): MaybePromise<CompletionResponseMiddlewareResult<RawResponse>>;
  onToolInput?(args: ToolInputMiddlewareArgs): MaybePromise<ToolInputMiddlewareResult>;
  onToolOutput?(args: ToolOutputMiddlewareArgs): MaybePromise<ToolOutputMiddlewareResult>;
}

export function createMiddleware<RawResponse = unknown>(
  middleware: AgentMiddleware<RawResponse>,
): AgentMiddleware<RawResponse> {
  return middleware;
}
