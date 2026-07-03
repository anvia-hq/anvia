import type { Message } from "@anvia/core/completion";
import {
  type UIMessage,
  type UIStreamEvent,
  type UIStreamRequest,
  uiMessagesToCoreMessages,
} from "@anvia/core/ui";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { createFetchTransport } from "./transport";
import type { EventStreamFormat, EventTransport } from "./types";
import {
  appendAssistantDelta,
  applyAnviaStreamEvent,
  applyUIStreamEvent,
  assistantText,
  createUserMessage,
  replaceAssistantText,
} from "./ui-messages";

export type UseCompletionStatus = "idle" | "streaming" | "error";

export type UseCompletionRequestArgs = {
  messages: UIMessage[];
  uiMessages: UIMessage[];
  coreMessages: Message[];
};

export type UseCompletionOptions<TRequest = UIStreamRequest, TEvent = UIStreamEvent> = {
  transport?: EventTransport<TRequest, TEvent>;
  endpoint?: string | URL;
  format?: EventStreamFormat;
  initialMessages?: UIMessage[];
  initialCompletion?: string;
  createRequest?: (args: UseCompletionRequestArgs) => TRequest;
  eventToUIEvent?: (event: TEvent) => UIStreamEvent | undefined;
  eventToDelta?: (event: TEvent) => string | undefined;
  eventToFinal?: (event: TEvent) => string | undefined;
  onEvent?: (event: TEvent) => void;
  onError?: (error: unknown) => void;
};

export type UseCompletionResult<TEvent = UIStreamEvent> = {
  messages: UIMessage[];
  completion: string;
  input: string;
  setInput(input: string): void;
  complete(prompt?: string): Promise<void>;
  stop(): void;
  reset(messagesOrCompletion?: UIMessage[] | string): void;
  status: UseCompletionStatus;
  error: unknown;
  events: TEvent[];
};

export function useCompletion<TRequest = UIStreamRequest, TEvent = UIStreamEvent>(
  options: UseCompletionOptions<TRequest, TEvent> = {},
): UseCompletionResult<TEvent> {
  const initialMessages = useMemo(
    () =>
      options.initialMessages ??
      (options.initialCompletion === undefined
        ? []
        : [
            {
              id: "initial_assistant",
              role: "assistant" as const,
              parts: [
                {
                  id: "initial_assistant_text",
                  type: "text" as const,
                  text: options.initialCompletion,
                },
              ],
            },
          ]),
    [options.initialCompletion, options.initialMessages],
  );
  const [messages, setMessagesState] = useState<UIMessage[]>(() => [...initialMessages]);
  const [input, setInput] = useState("");
  const [events, setEvents] = useState<TEvent[]>([]);
  const [status, setStatus] = useState<UseCompletionStatus>("idle");
  const [error, setError] = useState<unknown>();
  const abortRef = useRef<AbortController | undefined>(undefined);
  const messagesRef = useRef(messages);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const transport = useMemo(() => {
    if (options.transport !== undefined) {
      return options.transport;
    }
    if (options.endpoint === undefined) {
      return undefined;
    }

    return createFetchTransport<UIStreamRequest, UIStreamEvent>({
      endpoint: options.endpoint,
      format: options.format ?? "jsonl",
    }) as EventTransport<TRequest, TEvent>;
  }, [options.transport, options.endpoint, options.format]);

  const setMessages = useCallback((nextMessages: UIMessage[]) => {
    messagesRef.current = nextMessages;
    setMessagesState(nextMessages);
  }, []);

  const applyEvent = useCallback(
    (event: TEvent) => {
      const mappedUIEvent = options.eventToUIEvent?.(event);
      if (mappedUIEvent !== undefined) {
        setMessagesState((current) => {
          const next = applyUIStreamEvent(current, mappedUIEvent);
          messagesRef.current = next;
          return next;
        });
        return;
      }

      const hasCustomEventMapper =
        options.eventToUIEvent !== undefined ||
        options.eventToDelta !== undefined ||
        options.eventToFinal !== undefined;

      if (!hasCustomEventMapper) {
        let handled = false;
        setMessagesState((current) => {
          const next = applyAnviaStreamEvent(current, event);
          if (next === undefined) {
            return current;
          }
          handled = true;
          messagesRef.current = next;
          return next;
        });
        if (handled) {
          return;
        }
      }

      const delta = options.eventToDelta?.(event);
      if (delta !== undefined && delta.length > 0) {
        setMessagesState((current) => {
          const next = appendAssistantDelta(current, delta);
          messagesRef.current = next;
          return next;
        });
      }

      const final = options.eventToFinal?.(event);
      if (final !== undefined) {
        setMessagesState((current) => {
          const next = replaceAssistantText(current, final);
          messagesRef.current = next;
          return next;
        });
      }
    },
    [options],
  );

  const complete = useCallback(
    async (nextInput?: string) => {
      if (transport === undefined) {
        throw new Error("useCompletion requires either transport or endpoint");
      }

      const prompt = nextInput ?? input;
      const userMessage = createUserMessage(prompt);
      if (userMessage === undefined) {
        return;
      }
      const previousAbortController = abortRef.current;
      previousAbortController?.abort();
      const currentMessages = messagesRef.current;
      const baseMessages =
        previousAbortController !== undefined && currentMessages.at(-1)?.role === "assistant"
          ? currentMessages.slice(0, -1)
          : currentMessages;
      const nextMessages = [...baseMessages, userMessage];

      const abortController = new AbortController();
      abortRef.current = abortController;

      const createRequest =
        options.createRequest ??
        ((args: UseCompletionRequestArgs) =>
          ({ messages: args.coreMessages, stream: true }) as TRequest);

      setMessages(nextMessages);
      setInput("");
      setEvents([]);
      setError(undefined);
      setStatus("streaming");

      try {
        const coreMessages = uiMessagesToCoreMessages(nextMessages);
        const request = createRequest({
          messages: nextMessages,
          uiMessages: nextMessages,
          coreMessages,
        });

        for await (const event of transport.send(request, { signal: abortController.signal })) {
          setEvents((current) => [...current, event]);
          options.onEvent?.(event);
          applyEvent(event);
        }

        if (!abortController.signal.aborted) {
          setStatus("idle");
        }
      } catch (caught) {
        if (isAbortError(caught)) {
          if (abortRef.current === abortController) {
            setStatus("idle");
          }
          return;
        }

        setError(caught);
        setStatus("error");
        options.onError?.(caught);
      } finally {
        if (abortRef.current === abortController) {
          abortRef.current = undefined;
        }
      }
    },
    [applyEvent, input, options, setMessages, transport],
  );

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = undefined;
    setStatus("idle");
  }, []);

  const reset = useCallback(
    (messagesOrCompletion?: UIMessage[] | string) => {
      abortRef.current?.abort();
      abortRef.current = undefined;
      if (Array.isArray(messagesOrCompletion)) {
        setMessages(messagesOrCompletion);
      } else if (typeof messagesOrCompletion === "string") {
        setMessages([
          {
            id: "reset_assistant",
            role: "assistant",
            parts: [{ id: "reset_assistant_text", type: "text", text: messagesOrCompletion }],
          },
        ]);
      } else {
        setMessages([]);
      }
      setEvents([]);
      setError(undefined);
      setInput("");
      setStatus("idle");
    },
    [setMessages],
  );

  return {
    messages,
    completion: assistantText(messages),
    input,
    setInput,
    complete,
    stop,
    reset,
    status,
    error,
    events,
  };
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}
