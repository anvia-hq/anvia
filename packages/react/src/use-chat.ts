import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  createMessage,
  defaultCreateRequest,
  defaultEventToDelta,
  defaultEventToFinal,
} from "./chat-defaults";
import { createChatTransport } from "./transport";
import type { ChatMessage, DefaultChatRequest, UseChatOptions, UseChatResult } from "./types";

export function useChat<
  TRequest = DefaultChatRequest,
  TEvent = unknown,
  TMessage extends ChatMessage = ChatMessage,
>(options: UseChatOptions<TRequest, TEvent, TMessage> = {}): UseChatResult<TEvent, TMessage> {
  const [messages, setMessages] = useState<TMessage[]>(() => [...(options.initialMessages ?? [])]);
  const [events, setEvents] = useState<TEvent[]>([]);
  const [input, setInput] = useState("");
  const [status, setStatus] = useState<UseChatResult<TEvent, TMessage>["status"]>("idle");
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

    return createChatTransport<TRequest, TEvent>({
      endpoint: options.endpoint,
      format: options.format ?? "jsonl",
    });
  }, [options.transport, options.endpoint, options.format]);

  const createRequest = options.createRequest ?? defaultCreateRequest<TRequest, TMessage>;
  const eventToDelta = options.eventToDelta ?? defaultEventToDelta<TEvent>;
  const eventToFinal = options.eventToFinal ?? defaultEventToFinal<TEvent>;

  const appendAssistantText = useCallback((assistantId: string, text: string) => {
    setMessages((current) =>
      current.map((message) =>
        message.id === assistantId
          ? ({ ...message, content: `${message.content}${text}` } as TMessage)
          : message,
      ),
    );
  }, []);

  const replaceAssistantText = useCallback((assistantId: string, text: string) => {
    setMessages((current) =>
      current.map((message) =>
        message.id === assistantId ? ({ ...message, content: text } as TMessage) : message,
      ),
    );
  }, []);

  const send = useCallback(
    async (nextInput?: string) => {
      if (transport === undefined) {
        throw new Error("useChat requires either transport or endpoint");
      }

      const content = nextInput ?? input;
      if (content.trim().length === 0) {
        return;
      }

      abortRef.current?.abort();
      const abortController = new AbortController();
      abortRef.current = abortController;

      const userMessage = createMessage<TMessage>("user", content);
      const assistantMessage = createMessage<TMessage>("assistant", "");
      const requestMessages = [...messagesRef.current, userMessage];
      const request = createRequest(content, requestMessages);

      setInput("");
      setError(undefined);
      setStatus("streaming");
      setEvents([]);
      setMessages([...requestMessages, assistantMessage]);

      try {
        for await (const event of transport.send(request, { signal: abortController.signal })) {
          setEvents((current) => [...current, event]);
          options.onEvent?.(event);

          const delta = eventToDelta(event);
          if (delta !== undefined && delta.length > 0) {
            appendAssistantText(assistantMessage.id, delta);
          }

          const final = eventToFinal(event);
          if (final !== undefined) {
            replaceAssistantText(assistantMessage.id, final);
          }
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
    [
      appendAssistantText,
      createRequest,
      eventToDelta,
      eventToFinal,
      input,
      options,
      replaceAssistantText,
      transport,
    ],
  );

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = undefined;
    setStatus("idle");
  }, []);

  const reset = useCallback((nextMessages?: TMessage[]) => {
    const resetMessages = nextMessages ?? [];
    messagesRef.current = resetMessages;
    abortRef.current?.abort();
    abortRef.current = undefined;
    setMessages(resetMessages);
    setEvents([]);
    setError(undefined);
    setInput("");
    setStatus("idle");
  }, []);

  const text = messages
    .filter((message) => message.role === "assistant")
    .map((message) => message.content)
    .join("");

  return {
    messages,
    events,
    input,
    setInput,
    send,
    stop,
    reset,
    status,
    error,
    text,
  };
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}
