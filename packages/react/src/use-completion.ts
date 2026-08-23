import {
  applyClientStreamEvent,
  assistantText,
  type ClientCompletionRequest,
  type ClientDataMap,
  type ClientMetadata,
  ClientProtocolError,
  type ClientStreamEvent,
  type ClientTransport,
  normalizeClientError,
  type UIMessage,
} from "@anvia/client";
import type { ContextUsage } from "@anvia/core/completion";
import { useCallback, useEffect, useRef, useState } from "react";
import { contextUsageUpdateFromEvent } from "./context-usage";
import type { UseChatStatus } from "./types";

export type UseCompletionStatus = UseChatStatus;

export type UseCompletionOptions<
  Metadata extends ClientMetadata = ClientMetadata,
  Data extends ClientDataMap = ClientDataMap,
> = {
  transport: ClientTransport<ClientCompletionRequest<Metadata>, Data, Metadata>;
  initialInput?: string;
  initialCompletion?: string;
  onEvent?(event: ClientStreamEvent<Metadata, Data>): void;
  onError?(error: Error): void;
};

export type UseCompletionResult<
  Metadata extends ClientMetadata = ClientMetadata,
  Data extends ClientDataMap = ClientDataMap,
> = {
  completion: string;
  input: string;
  setInput(input: string): void;
  complete(options: ClientCompletionRequest<Metadata>): Promise<void>;
  submit(): Promise<void>;
  stop(): void;
  reset(): void;
  status: UseCompletionStatus;
  error: Error | undefined;
  events: readonly ClientStreamEvent<Metadata, Data>[];
  contextUsage: ContextUsage | undefined;
};

export function useCompletion<
  Metadata extends ClientMetadata = ClientMetadata,
  Data extends ClientDataMap = ClientDataMap,
>(options: UseCompletionOptions<Metadata, Data>): UseCompletionResult<Metadata, Data> {
  const [input, setInput] = useState(options.initialInput ?? "");
  const [completion, setCompletion] = useState(options.initialCompletion ?? "");
  const [events, setEvents] = useState<ClientStreamEvent<Metadata, Data>[]>([]);
  const [contextUsage, setContextUsage] = useState<ContextUsage>();
  const [status, setStatus] = useState<UseCompletionStatus>("ready");
  const [error, setError] = useState<Error>();
  const messagesRef = useRef<readonly UIMessage<Metadata, Data>[]>([]);
  const abortRef = useRef<AbortController | undefined>(undefined);

  useEffect(() => () => abortRef.current?.abort(), []);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = undefined;
    setStatus("ready");
  }, []);

  const complete = useCallback(
    async (request: ClientCompletionRequest<Metadata>) => {
      if (request.prompt.trim().length === 0) {
        throw new TypeError("complete requires a nonblank prompt.");
      }

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      messagesRef.current = [];
      setCompletion("");
      setEvents([]);
      setContextUsage(undefined);
      setError(undefined);
      setStatus("submitted");

      let streamError: Error | undefined;
      try {
        for await (const frame of options.transport.send({
          request,
          abortSignal: controller.signal,
        })) {
          if (abortRef.current !== controller || controller.signal.aborted) return;
          if (frame.type === "stream_start") continue;
          if (frame.type === "stream_event") {
            setStatus("streaming");
            const event = frame.event;
            setEvents((current) => [...current, event]);
            options.onEvent?.(event);
            const nextContextUsage = contextUsageUpdateFromEvent(event);
            if (nextContextUsage !== undefined) setContextUsage(nextContextUsage);
            messagesRef.current = applyClientStreamEvent(messagesRef.current, event);
            setCompletion(assistantText(messagesRef.current));
            if (event.type === "error") {
              const eventError = normalizeClientError(event.error);
              streamError ??= eventError;
              setError(eventError);
              setStatus("error");
              options.onError?.(eventError);
            }
            continue;
          }
          if (frame.status !== "completed") {
            throw new ClientProtocolError(
              `Client completion stream ended with status ${frame.status}.`,
              frame,
            );
          }
        }
        if (abortRef.current === controller && !controller.signal.aborted) {
          setStatus(streamError === undefined ? "ready" : "error");
        }
      } catch (caught) {
        if (isAbortError(caught)) {
          if (abortRef.current === controller) setStatus("ready");
          return;
        }
        if (abortRef.current !== controller) return;
        const nextError = normalizeClientError(caught);
        setError(nextError);
        setStatus("error");
        options.onError?.(nextError);
      } finally {
        if (abortRef.current === controller) abortRef.current = undefined;
      }
    },
    [options],
  );

  const submit = useCallback(() => complete({ prompt: input }), [complete, input]);

  const reset = useCallback(() => {
    stop();
    setInput(options.initialInput ?? "");
    setCompletion(options.initialCompletion ?? "");
    setEvents([]);
    setContextUsage(undefined);
    setError(undefined);
    messagesRef.current = [];
  }, [options.initialCompletion, options.initialInput, stop]);

  return {
    completion,
    input,
    setInput,
    complete,
    submit,
    stop,
    reset,
    status,
    error,
    events,
    contextUsage,
  };
}

function isAbortError(error: unknown): boolean {
  return (
    typeof error === "object" && error !== null && "name" in error && error.name === "AbortError"
  );
}
