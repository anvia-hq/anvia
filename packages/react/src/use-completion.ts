import {
  type ClientDataMap,
  type ClientStreamEvent,
  type ClientStreamRequest,
  createClientId,
  type UIMessage,
} from "@anvia/client";
import type { ContextUsage, Message } from "@anvia/core/completion";
import { useCallback, useMemo, useState } from "react";
import type { ClientConnectionOptions, UseChatStatus } from "./types";
import { useChat } from "./use-chat";

export type UseCompletionStatus = UseChatStatus;

export type UseCompletionRequestArgs = {
  uiMessages: UIMessage[];
  messages: Message[];
};

type UseCompletionCommonOptions<TRequest, TData extends ClientDataMap> = {
  initialMessages?: UIMessage[];
  initialCompletion?: string;
  createRequest?: (args: UseCompletionRequestArgs) => TRequest;
  onEvent?: (event: ClientStreamEvent<TData>) => void;
  onError?: (error: Error) => void;
};

export type UseCompletionOptions<
  TRequest = ClientStreamRequest,
  TData extends ClientDataMap = ClientDataMap,
> = ClientConnectionOptions<TRequest, TData> & UseCompletionCommonOptions<TRequest, TData>;

export type UseCompletionResult<TData extends ClientDataMap = ClientDataMap> = {
  messages: UIMessage[];
  completion: string;
  input: string;
  setInput(input: string): void;
  complete(prompt?: string): Promise<void>;
  stop(): void;
  reset(messagesOrCompletion?: UIMessage[] | string): void;
  status: UseCompletionStatus;
  error: Error | undefined;
  events: ClientStreamEvent<TData>[];
  contextUsage: ContextUsage | undefined;
};

export function useCompletion<
  TRequest = ClientStreamRequest,
  TData extends ClientDataMap = ClientDataMap,
>(options: UseCompletionOptions<TRequest, TData>): UseCompletionResult<TData> {
  const [input, setInput] = useState("");
  const initialMessages = useMemo(
    () => options.initialMessages ?? initialCompletionMessage(options.initialCompletion),
    [options.initialCompletion, options.initialMessages],
  );
  const connection =
    options.transport !== undefined
      ? { transport: options.transport }
      : {
          endpoint: options.endpoint,
          ...(options.format === undefined ? {} : { format: options.format }),
          ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
          ...(options.headers === undefined ? {} : { headers: options.headers }),
          ...(options.body === undefined ? {} : { body: options.body }),
          ...(options.dataSchemas === undefined ? {} : { dataSchemas: options.dataSchemas }),
        };
  const chat = useChat<TRequest, TData>({
    ...connection,
    initialMessages,
    ...(options.createRequest === undefined
      ? {}
      : {
          createRequest: (args) =>
            options.createRequest?.({
              uiMessages: args.uiMessages,
              messages: args.messages,
            }) as TRequest,
        }),
    ...(options.onEvent === undefined ? {} : { onEvent: options.onEvent }),
    ...(options.onError === undefined ? {} : { onError: options.onError }),
  });

  const complete = useCallback(
    async (prompt?: string) => {
      const value = prompt ?? input;
      setInput("");
      await chat.sendMessage(value);
    },
    [chat.sendMessage, input],
  );

  const reset = useCallback(
    (messagesOrCompletion?: UIMessage[] | string) => {
      setInput("");
      if (Array.isArray(messagesOrCompletion)) {
        chat.reset(messagesOrCompletion);
      } else {
        chat.reset(initialCompletionMessage(messagesOrCompletion));
      }
    },
    [chat.reset],
  );

  return {
    messages: chat.messages,
    completion: chat.text,
    input,
    setInput,
    complete,
    stop: chat.stop,
    reset,
    status: chat.status,
    error: chat.error,
    events: chat.events,
    contextUsage: chat.contextUsage,
  };
}

function initialCompletionMessage(completion: string | undefined): UIMessage[] {
  if (completion === undefined) return [];
  const id = createClientId("initial_assistant");
  return [
    {
      id,
      role: "assistant",
      parts: [{ id: `${id}_text`, type: "text", text: completion }],
    },
  ];
}
