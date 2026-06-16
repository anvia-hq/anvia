import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  defaultCompletionEventToDelta,
  defaultCompletionEventToFinal,
} from "./completion-defaults";
import { createFetchTransport } from "./transport";
import type { EventStreamFormat, EventTransport } from "./types";

export type UseCompletionRequest = {
  prompt: string;
  stream: true;
};

export type UseCompletionStatus = "idle" | "streaming" | "error";

export type UseCompletionOptions<TEvent = unknown> = {
  transport?: EventTransport<UseCompletionRequest, TEvent>;
  endpoint?: string | URL;
  format?: EventStreamFormat;
  initialCompletion?: string;
  eventToDelta?: (event: TEvent) => string | undefined;
  eventToFinal?: (event: TEvent) => string | undefined;
  onEvent?: (event: TEvent) => void;
  onError?: (error: unknown) => void;
};

export type UseCompletionResult = {
  completion: string;
  input: string;
  setInput(input: string): void;
  complete(prompt?: string): Promise<void>;
  stop(): void;
  reset(completion?: string): void;
  status: UseCompletionStatus;
  error: unknown;
};

export function useCompletion<TEvent = unknown>(
  options: UseCompletionOptions<TEvent> = {},
): UseCompletionResult {
  const [completion, setCompletion] = useState(options.initialCompletion ?? "");
  const [input, setInput] = useState("");
  const [status, setStatus] = useState<UseCompletionStatus>("idle");
  const [error, setError] = useState<unknown>();
  const abortRef = useRef<AbortController | undefined>(undefined);
  const completionRef = useRef(completion);

  useEffect(() => {
    completionRef.current = completion;
  }, [completion]);

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

    return createFetchTransport<UseCompletionRequest, TEvent>({
      endpoint: options.endpoint,
      format: options.format ?? "jsonl",
    });
  }, [options.transport, options.endpoint, options.format]);

  const eventToDelta = options.eventToDelta ?? defaultCompletionEventToDelta<TEvent>;
  const eventToFinal = options.eventToFinal ?? defaultCompletionEventToFinal<TEvent>;

  const complete = useCallback(
    async (nextInput?: string) => {
      if (transport === undefined) {
        throw new Error("useCompletion requires either transport or endpoint");
      }

      const prompt = nextInput ?? input;
      if (prompt.trim().length === 0) {
        return;
      }

      abortRef.current?.abort();
      const abortController = new AbortController();
      abortRef.current = abortController;

      const request: UseCompletionRequest = { prompt, stream: true };

      setInput("");
      setError(undefined);
      setStatus("streaming");
      setCompletion("");

      try {
        for await (const event of transport.send(request, { signal: abortController.signal })) {
          options.onEvent?.(event);

          const delta = eventToDelta(event);
          if (delta !== undefined && delta.length > 0) {
            setCompletion((current) => `${current}${delta}`);
          }

          const final = eventToFinal(event);
          if (final !== undefined) {
            setCompletion(final);
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
    [eventToDelta, eventToFinal, input, options, transport],
  );

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = undefined;
    setStatus("idle");
  }, []);

  const reset = useCallback((nextCompletion?: string) => {
    abortRef.current?.abort();
    abortRef.current = undefined;
    setCompletion(nextCompletion ?? "");
    setError(undefined);
    setInput("");
    setStatus("idle");
  }, []);

  return {
    completion,
    input,
    setInput,
    complete,
    stop,
    reset,
    status,
    error,
  };
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}
