import type { UIStreamEvent, UIStreamRequest } from "@anvia/core/ui";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { createChatTransport } from "./transport";
import type { EventTransport, SendMessageInput, UseChatOptions, UseChatResult } from "./types";
import {
  appendAssistantDelta,
  applyAnviaStreamEvent,
  applyUIStreamEvent,
  assistantText,
  createUserMessage,
  replaceAssistantText,
} from "./ui-messages";

export function useChat<TRequest = UIStreamRequest, TEvent = UIStreamEvent>(
  options: UseChatOptions<TRequest, TEvent> = {},
): UseChatResult<TEvent> {
  const [messages, setMessagesState] = useState(() => [...(options.initialMessages ?? [])]);
  const [events, setEvents] = useState<TEvent[]>([]);
  const [status, setStatus] = useState<UseChatResult<TEvent>["status"]>("idle");
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

    return createChatTransport<UIStreamRequest, UIStreamEvent>({
      endpoint: options.endpoint,
      format: options.format ?? "jsonl",
    }) as EventTransport<TRequest, TEvent>;
  }, [options.transport, options.endpoint, options.format]);

  const setMessages = useCallback<UseChatResult<TEvent>["setMessages"]>((nextMessages) => {
    setMessagesState((current) => {
      const next = typeof nextMessages === "function" ? nextMessages(current) : nextMessages;
      messagesRef.current = next;
      return next;
    });
  }, []);

  const applyEvent = useCallback(
    (event: TEvent) => {
      const mappedUIEvent = options.eventToUIEvent?.(event);
      if (mappedUIEvent !== undefined) {
        setMessages((current) => applyUIStreamEvent(current, mappedUIEvent));
        return;
      }

      if (options.eventToUIEvent === undefined) {
        let handled = false;
        setMessages((current) => {
          const next = applyAnviaStreamEvent(current, event);
          if (next === undefined) {
            return current;
          }
          handled = true;
          return next;
        });
        if (handled) {
          return;
        }
      }

      const delta = options.eventToDelta?.(event);
      if (delta !== undefined && delta.length > 0) {
        setMessages((current) => appendAssistantDelta(current, delta));
      }

      const final = options.eventToFinal?.(event);
      if (final !== undefined) {
        setMessages((current) => replaceAssistantText(current, final));
      }
    },
    [options, setMessages],
  );

  const sendMessages = useCallback(
    async (nextMessages: UIStreamRequest["messages"]) => {
      if (transport === undefined) {
        throw new Error("useChat requires either transport or endpoint");
      }

      abortRef.current?.abort();
      const abortController = new AbortController();
      abortRef.current = abortController;

      const createRequest =
        options.createRequest ??
        ((args: { messages: UIStreamRequest["messages"] }) =>
          ({ messages: args.messages, stream: true }) as TRequest);
      const request = createRequest({ messages: nextMessages });

      setMessages(nextMessages);
      setEvents([]);
      setError(undefined);
      setStatus("streaming");

      try {
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
          setStatus("idle");
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
    [applyEvent, options, setMessages, transport],
  );

  const sendMessage = useCallback(
    async (input: SendMessageInput) => {
      const message = createUserMessage(input);
      if (message === undefined) {
        return;
      }
      await sendMessages([...messagesRef.current, message]);
    },
    [sendMessages],
  );

  const send = useCallback(
    async (input = "") => {
      await sendMessage(input);
    },
    [sendMessage],
  );

  const regenerate = useCallback(async () => {
    const lastUserIndex = findLastUserIndex(messagesRef.current);
    if (lastUserIndex === -1) {
      return;
    }
    await sendMessages(messagesRef.current.slice(0, lastUserIndex + 1));
  }, [sendMessages]);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = undefined;
    setStatus("idle");
  }, []);

  const reset = useCallback(
    (nextMessages: UIStreamRequest["messages"] = []) => {
      abortRef.current?.abort();
      abortRef.current = undefined;
      setMessages(nextMessages);
      setEvents([]);
      setError(undefined);
      setStatus("idle");
    },
    [setMessages],
  );

  return {
    messages,
    events,
    setMessages,
    sendMessage,
    send,
    regenerate,
    stop,
    reset,
    status,
    error,
    text: assistantText(messages),
  };
}

function findLastUserIndex(messages: UIStreamRequest["messages"]): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === "user") {
      return index;
    }
  }
  return -1;
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}
