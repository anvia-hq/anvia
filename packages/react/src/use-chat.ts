import {
  applyClientStreamEvent,
  assistantText,
  type ClientInteraction,
  ClientProtocolError,
  type ClientStreamCursor,
  type ClientStreamEvent,
  type ClientStreamRequest,
  type ClientTransport,
  normalizeClientError,
  type UIMessage,
  uiMessagesToMessages,
} from "@anvia/client";
import {
  type AgentInteractionResponse,
  assertAgentInteractionResponse,
  parseAgentInteractionResponse,
} from "@anvia/core/agent/interactions";
import { useCallback, useEffect, useRef, useState } from "react";
import { contextUsageFromMessages, contextUsageUpdateFromEvent } from "./context-usage";
import { clearChatResumeState, loadChatResumeState, saveChatResumeState } from "./resume";
import type {
  AnyClientTransport,
  SendMessageInput,
  TransportData,
  TransportMetadata,
  UseChatOptions,
  UseChatResult,
} from "./types";
import { createUserMessage } from "./ui-messages";

export function useChat<Transport extends AnyClientTransport = ClientTransport>(
  options: UseChatOptions<Transport>,
): UseChatResult<Transport> {
  type Metadata = TransportMetadata<Transport>;
  type Data = TransportData<Transport>;

  const [messages, setMessagesState] = useState<readonly UIMessage<Metadata, Data>[]>(() => [
    ...(options.initialMessages ?? []),
  ]);
  const [events, setEvents] = useState<ClientStreamEvent<Metadata, Data>[]>([]);
  const [contextUsage, setContextUsage] = useState(() =>
    contextUsageFromMessages(options.initialMessages ?? []),
  );
  const [status, setStatus] = useState<UseChatResult<Transport>["status"]>("ready");
  const [error, setError] = useState<Error>();
  const [interactions, setInteractions] = useState<ClientInteraction[]>([]);
  const [respondingInteractions, setRespondingInteractions] = useState<Set<string>>(
    () => new Set(),
  );
  const [streamId, setStreamIdState] = useState<string>();
  const [isResuming, setIsResuming] = useState(false);

  const messagesRef = useRef(messages);
  const interactionsRef = useRef(interactions);
  const respondingRef = useRef(respondingInteractions);
  const requestRef = useRef<ClientStreamRequest<Metadata> | undefined>(undefined);
  const waitingRef = useRef(false);
  const streamIdRef = useRef<string | undefined>(undefined);
  const lastEventIdRef = useRef(0);
  const abortRef = useRef<AbortController | undefined>(undefined);
  const autoResumeStartedRef = useRef(false);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);
  useEffect(() => {
    interactionsRef.current = interactions;
  }, [interactions]);
  useEffect(() => () => abortRef.current?.abort(), []);

  const transport = options.transport as unknown as ClientTransport<
    ClientStreamRequest<Metadata>,
    Data,
    Metadata
  >;

  const updateMessages = useCallback<UseChatResult<Transport>["setMessages"]>((next) => {
    const value = typeof next === "function" ? next(messagesRef.current) : next;
    messagesRef.current = value;
    setMessagesState(value);
  }, []);

  const setMessages = useCallback<UseChatResult<Transport>["setMessages"]>(
    (next) => {
      updateMessages((current) => {
        const value = typeof next === "function" ? next(current) : next;
        setContextUsage(contextUsageFromMessages(value));
        return value;
      });
    },
    [updateMessages],
  );

  const setStreamId = useCallback((value: string | undefined) => {
    streamIdRef.current = value;
    setStreamIdState(value);
  }, []);

  const persistResumeState = useCallback(() => {
    if (streamIdRef.current === undefined || requestRef.current === undefined) return;
    saveChatResumeState(options.resume, {
      version: 3,
      streamId: streamIdRef.current,
      lastEventId: lastEventIdRef.current,
      messages: messagesRef.current,
      interactions: interactionsRef.current,
      request: requestRef.current,
    });
  }, [options.resume]);

  const clearResumeState = useCallback(() => {
    lastEventIdRef.current = 0;
    setStreamId(undefined);
    clearChatResumeState(options.resume);
  }, [options.resume, setStreamId]);

  const updateInteraction = useCallback((interaction: ClientInteraction) => {
    const current = interactionsRef.current;
    const index = current.findIndex((item) => item.request.id === interaction.request.id);
    const next = index === -1 ? [...current, interaction] : [...current];
    if (index !== -1) next[index] = interaction;
    interactionsRef.current = next;
    setInteractions(next);
  }, []);

  const applyEvent = useCallback(
    (event: ClientStreamEvent<Metadata, Data>): Error | undefined => {
      setEvents((current) => [...current, event]);
      options.onEvent?.(event);
      const nextContextUsage = contextUsageUpdateFromEvent(event);
      if (nextContextUsage !== undefined) setContextUsage(nextContextUsage);
      if (event.type === "interaction") {
        updateInteraction({ request: event.interaction, runId: event.runId, status: "pending" });
      }
      if (event.type === "run_end") {
        waitingRef.current = event.status === "suspended";
      }
      updateMessages((current) => applyClientStreamEvent(current, event));
      if (event.type !== "error") return undefined;
      const nextError = normalizeClientError(event.error);
      setError(nextError);
      options.onError?.(nextError);
      return nextError;
    },
    [options, updateInteraction, updateMessages],
  );

  const runRequest = useCallback(
    async (
      request: ClientStreamRequest<Metadata>,
      nextMessages: readonly UIMessage<Metadata, Data>[],
      runOptions: RunRequestOptions = {},
    ) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      waitingRef.current =
        runOptions.isResuming === true &&
        interactionsRef.current.some((interaction) => interaction.status === "pending");

      const activeRequest =
        runOptions.resume === undefined ? request : { ...request, resume: runOptions.resume };
      requestRef.current = activeRequest;
      if (runOptions.resume === undefined) {
        clearResumeState();
      } else {
        lastEventIdRef.current = runOptions.resume.after;
        setStreamId(runOptions.resume.streamId);
      }
      updateMessages(nextMessages);
      setContextUsage(contextUsageFromMessages(nextMessages));
      setEvents([]);
      setError(undefined);
      if (runOptions.clearInteractions === true) {
        interactionsRef.current = [];
        setInteractions([]);
      }
      setStatus("submitted");
      setIsResuming(runOptions.isResuming === true);

      let streamError: Error | undefined;
      let accepted = false;
      try {
        const sendOptions: Parameters<typeof transport.send>[0] = {
          request: activeRequest,
          abortSignal: controller.signal,
        };
        if (runOptions.resume !== undefined) sendOptions.resume = runOptions.resume;
        for await (const frame of transport.send(sendOptions)) {
          if (abortRef.current !== controller || controller.signal.aborted) return accepted;
          if (frame.type === "stream_start") {
            accepted = true;
            runOptions.onAccepted?.();
            setStreamId(frame.streamId);
            persistResumeState();
            continue;
          }
          if (frame.type === "stream_event") {
            lastEventIdRef.current = frame.eventId;
            if (streamError === undefined) setStatus("streaming");
            streamError = applyEvent(frame.event) ?? streamError;
            if (streamError !== undefined) setStatus("error");
            persistResumeState();
            continue;
          }
          lastEventIdRef.current = frame.eventId;
          clearResumeState();
          if (frame.status !== "completed") {
            throw new ClientProtocolError(
              `Client stream ended with status ${frame.status}.`,
              frame,
            );
          }
        }
        if (abortRef.current === controller && !controller.signal.aborted) {
          setStatus(streamError !== undefined ? "error" : waitingRef.current ? "waiting" : "ready");
        }
      } catch (caught) {
        if (isAbortError(caught)) {
          if (abortRef.current === controller) setStatus("ready");
          return accepted;
        }
        if (abortRef.current !== controller) return accepted;
        const nextError = normalizeClientError(caught);
        setError(nextError);
        setStatus("error");
        options.onError?.(nextError);
      } finally {
        if (abortRef.current === controller) {
          abortRef.current = undefined;
          setIsResuming(false);
        }
      }
      return accepted;
    },
    [
      applyEvent,
      clearResumeState,
      options,
      persistResumeState,
      setStreamId,
      transport,
      updateMessages,
    ],
  );

  const sendMessages = useCallback(
    async (nextMessages: readonly UIMessage<Metadata, Data>[]) => {
      await runRequest(
        { type: "messages", messages: uiMessagesToMessages(nextMessages) },
        nextMessages,
        { clearInteractions: true },
      );
    },
    [runRequest],
  );

  const resume = useCallback(async () => {
    const saved = loadChatResumeState<Metadata, Data>(options.resume);
    if (saved === undefined) return;
    interactionsRef.current = [...saved.interactions];
    setInteractions([...saved.interactions]);
    await runRequest(saved.request, saved.messages, {
      resume: { streamId: saved.streamId, after: saved.lastEventId },
      isResuming: true,
    });
  }, [options.resume, runRequest]);

  useEffect(() => {
    if (options.resume?.auto === false || autoResumeStartedRef.current) return;
    autoResumeStartedRef.current = true;
    void resume();
  }, [options.resume?.auto, resume]);

  const sendMessage = useCallback(
    async (input: SendMessageInput<Metadata>) => {
      const message = createUserMessage<Metadata, Data>(input);
      const current = messagesRef.current;
      const base =
        abortRef.current !== undefined && current.at(-1)?.role === "assistant"
          ? current.slice(0, -1)
          : current;
      await sendMessages([...base, message]);
    },
    [sendMessages],
  );

  const regenerate = useCallback(async () => {
    const lastUser = findLastUserIndex(messagesRef.current);
    if (lastUser !== -1) await sendMessages(messagesRef.current.slice(0, lastUser + 1));
  }, [sendMessages]);

  const respondToInteraction = useCallback(
    async (input: { interactionId: string; response: AgentInteractionResponse }) => {
      const interaction = interactionsRef.current.find(
        (item) => item.request.id === input.interactionId && item.status === "pending",
      );
      if (interaction === undefined) {
        throw new TypeError(`No pending interaction exists for "${input.interactionId}".`);
      }
      const response = parseAgentInteractionResponse(input.response);
      assertAgentInteractionResponse(interaction.request, response);
      if (respondingRef.current.has(input.interactionId)) return;
      const responding = new Set(respondingRef.current).add(input.interactionId);
      respondingRef.current = responding;
      setRespondingInteractions(responding);
      try {
        const accepted = await runRequest(
          {
            type: "interaction_response",
            interactionId: input.interactionId,
            response,
          },
          messagesRef.current,
          {
            onAccepted: () => updateInteraction({ ...interaction, status: "responded" }),
          },
        );
        if (!accepted) {
          throw new ClientProtocolError("The interaction response was not accepted.");
        }
      } finally {
        const next = new Set(respondingRef.current);
        next.delete(input.interactionId);
        respondingRef.current = next;
        setRespondingInteractions(next);
      }
    },
    [runRequest, updateInteraction],
  );

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = undefined;
    clearResumeState();
    setStatus("ready");
    setIsResuming(false);
  }, [clearResumeState]);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = undefined;
    clearResumeState();
    updateMessages([]);
    setContextUsage(undefined);
    setEvents([]);
    interactionsRef.current = [];
    respondingRef.current = new Set();
    setInteractions([]);
    setRespondingInteractions(new Set());
    setError(undefined);
    setStatus("ready");
    setIsResuming(false);
  }, [clearResumeState, updateMessages]);

  return {
    messages,
    events,
    contextUsage,
    suggestions: options.suggestions ?? [],
    setMessages,
    sendMessage,
    regenerate,
    stop,
    reset,
    status,
    error,
    text: assistantText(messages),
    streamId,
    isResuming,
    resume,
    interactions: {
      all: interactions,
      pending: interactions.filter((item) => item.status === "pending"),
    },
    respondingInteractions: new Set(respondingInteractions),
    respondToInteraction,
  };
}

type RunRequestOptions = {
  resume?: ClientStreamCursor;
  isResuming?: boolean;
  clearInteractions?: boolean;
  onAccepted?: () => void;
};

function findLastUserIndex(messages: readonly UIMessage[]): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === "user") return index;
  }
  return -1;
}

function isAbortError(error: unknown): boolean {
  return (
    typeof error === "object" && error !== null && "name" in error && error.name === "AbortError"
  );
}
