import {
  applyClientStreamEvent,
  assistantText,
  type ClientDataMap,
  ClientProtocolError,
  type ClientStreamCursor,
  type ClientStreamEvent,
  type ClientStreamRequest,
  type ClientTransport,
  createHttpClientTransport,
  normalizeClientError,
  type ToolApproval,
  type ToolQuestion,
  type ToolQuestionAnswer,
  type UIMessage,
  uiMessagesToMessages,
} from "@anvia/client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { contextUsageFromMessages, contextUsageUpdateFromEvent } from "./context-usage";
import { defaultAnswerQuestion, defaultDecideApproval, upsertById } from "./human-input";
import { clearChatResumeState, loadChatResumeState, saveChatResumeState } from "./resume";
import type {
  CreateChatRequestArgs,
  SendMessageInput,
  ToolApprovalDecisionInput,
  ToolQuestionAnswerInput,
  UseChatOptions,
  UseChatResult,
} from "./types";
import { createUserMessage } from "./ui-messages";

export function useChat<
  TRequest = ClientStreamRequest,
  TData extends ClientDataMap = ClientDataMap,
>(options: UseChatOptions<TRequest, TData>): UseChatResult<TData> {
  const [messages, setMessagesState] = useState<UIMessage[]>(() => [
    ...(options.initialMessages ?? []),
  ]);
  const [events, setEvents] = useState<ClientStreamEvent<TData>[]>([]);
  const [contextUsage, setContextUsage] = useState(() =>
    contextUsageFromMessages(options.initialMessages ?? []),
  );
  const [status, setStatus] = useState<UseChatResult<TData>["status"]>("ready");
  const [error, setError] = useState<Error>();
  const [approvals, setApprovals] = useState<ToolApproval[]>([]);
  const [questions, setQuestions] = useState<ToolQuestion[]>([]);
  const [decidingApprovals, setDecidingApprovals] = useState<Set<string>>(() => new Set());
  const [answeringQuestions, setAnsweringQuestions] = useState<Set<string>>(() => new Set());
  const [streamId, setStreamIdState] = useState<string>();
  const [isResuming, setIsResuming] = useState(false);

  const messagesRef = useRef(messages);
  const approvalsRef = useRef(approvals);
  const questionsRef = useRef(questions);
  const decidingApprovalsRef = useRef(decidingApprovals);
  const answeringQuestionsRef = useRef(answeringQuestions);
  const streamIdRef = useRef<string | undefined>(undefined);
  const lastEventIdRef = useRef(0);
  const abortRef = useRef<AbortController | undefined>(undefined);
  const autoResumeStartedRef = useRef(false);
  const humanInputVersionRef = useRef(0);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);
  useEffect(() => {
    approvalsRef.current = approvals;
  }, [approvals]);
  useEffect(() => {
    questionsRef.current = questions;
  }, [questions]);
  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  const transport = useMemo<ClientTransport<TRequest, TData>>(() => {
    if (options.transport !== undefined) return options.transport;
    return createHttpClientTransport<TRequest, TData>({
      endpoint: options.endpoint,
      ...(options.format === undefined ? {} : { format: options.format }),
      ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
      ...(options.headers === undefined ? {} : { headers: options.headers }),
      ...(options.body === undefined ? {} : { body: options.body }),
      ...(options.dataSchemas === undefined ? {} : { dataSchemas: options.dataSchemas }),
    });
  }, [
    options.body,
    options.dataSchemas,
    options.endpoint,
    options.fetch,
    options.format,
    options.headers,
    options.transport,
  ]);

  const updateMessages = useCallback<UseChatResult<TData>["setMessages"]>((next) => {
    const value = typeof next === "function" ? next(messagesRef.current) : next;
    messagesRef.current = value;
    setMessagesState(value);
  }, []);

  const setMessages = useCallback<UseChatResult<TData>["setMessages"]>(
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
    if (streamIdRef.current === undefined) return;
    saveChatResumeState(options.resume, {
      version: 1,
      streamId: streamIdRef.current,
      lastEventId: lastEventIdRef.current,
      messages: messagesRef.current,
    });
  }, [options.resume]);

  const clearResumeState = useCallback(() => {
    lastEventIdRef.current = 0;
    setStreamId(undefined);
    clearChatResumeState(options.resume);
  }, [options.resume, setStreamId]);

  const updateApproval = useCallback((approval: ToolApproval) => {
    setApprovals((current) => {
      const next = upsertById(current, approval);
      approvalsRef.current = next;
      return next;
    });
  }, []);

  const updateQuestion = useCallback((question: ToolQuestion) => {
    setQuestions((current) => {
      const next = upsertById(current, question);
      questionsRef.current = next;
      return next;
    });
  }, []);

  const clearHumanInput = useCallback(() => {
    humanInputVersionRef.current += 1;
    approvalsRef.current = [];
    questionsRef.current = [];
    decidingApprovalsRef.current = new Set();
    answeringQuestionsRef.current = new Set();
    setApprovals([]);
    setQuestions([]);
    setDecidingApprovals(new Set());
    setAnsweringQuestions(new Set());
  }, []);

  const applyEvent = useCallback(
    (event: ClientStreamEvent<TData>): Error | undefined => {
      setEvents((current) => [...current, event]);
      options.onEvent?.(event);
      const nextContextUsage = contextUsageUpdateFromEvent(event);
      if (nextContextUsage !== undefined) setContextUsage(nextContextUsage);
      if (event.type === "tool_approval") updateApproval(event.approval);
      if (event.type === "tool_question") updateQuestion(event.question);
      updateMessages((current) => applyClientStreamEvent(current, event));
      if (event.type !== "error") return undefined;
      const nextError = normalizeClientError(event.error);
      setError(nextError);
      options.onError?.(nextError);
      return nextError;
    },
    [options, updateApproval, updateMessages, updateQuestion],
  );

  const sendMessages = useCallback(
    async (nextMessages: UIMessage[], runOptions: SendMessagesRunOptions = {}) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

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
      clearHumanInput();
      setStatus("submitted");
      setIsResuming(runOptions.isResuming === true);

      let streamError: Error | undefined;
      try {
        const coreMessages = uiMessagesToMessages(nextMessages);
        const args: CreateChatRequestArgs = {
          uiMessages: nextMessages,
          messages: coreMessages,
          ...(runOptions.resume === undefined ? {} : { resume: runOptions.resume }),
        };
        const request =
          options.createRequest?.(args) ??
          ({
            messages: coreMessages,
            ...(runOptions.resume === undefined ? {} : { resume: runOptions.resume }),
          } as TRequest);

        for await (const frame of transport.send(request, { signal: controller.signal })) {
          if (abortRef.current !== controller || controller.signal.aborted) return;
          if (frame.type === "stream_start") {
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
        if (abortRef.current === controller) {
          abortRef.current = undefined;
          setIsResuming(false);
        }
      }
    },
    [
      applyEvent,
      clearHumanInput,
      clearResumeState,
      options,
      persistResumeState,
      setStreamId,
      transport,
      updateMessages,
    ],
  );

  const resume = useCallback(async () => {
    const saved = loadChatResumeState(options.resume);
    if (saved === undefined) return;
    await sendMessages(saved.messages, {
      resume: { streamId: saved.streamId, after: saved.lastEventId },
      isResuming: true,
    });
  }, [options.resume, sendMessages]);

  useEffect(() => {
    if (options.resume?.auto === false || autoResumeStartedRef.current) return;
    autoResumeStartedRef.current = true;
    void resume();
  }, [options.resume?.auto, resume]);

  const sendMessage = useCallback(
    async (input: SendMessageInput) => {
      const message = createUserMessage(input);
      if (message === undefined) return;
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

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = undefined;
    clearResumeState();
    setStatus("ready");
    setIsResuming(false);
  }, [clearResumeState]);

  const decideToolApproval = useCallback(
    async (approvalId: string, approved: boolean, reason?: string) => {
      if (options.humanInput === undefined) throw new Error("useChat humanInput is not configured");
      if (decidingApprovalsRef.current.has(approvalId)) return;
      const version = humanInputVersionRef.current;
      const pending = new Set(decidingApprovalsRef.current).add(approvalId);
      decidingApprovalsRef.current = pending;
      setDecidingApprovals(pending);
      try {
        const approval = approvalsRef.current.find((item) => item.id === approvalId);
        const input: ToolApprovalDecisionInput = {
          approvalId,
          approved,
          ...(reason === undefined ? {} : { reason }),
          ...(approval === undefined ? {} : { approval }),
        };
        const result =
          options.humanInput.decideApproval === undefined
            ? await defaultDecideApproval(input, options.humanInput)
            : await options.humanInput.decideApproval(input);
        if (result !== undefined && humanInputVersionRef.current === version)
          updateApproval(result);
      } finally {
        if (humanInputVersionRef.current === version) {
          const next = new Set(decidingApprovalsRef.current);
          next.delete(approvalId);
          decidingApprovalsRef.current = next;
          setDecidingApprovals(next);
        }
      }
    },
    [options.humanInput, updateApproval],
  );

  const answerToolQuestion = useCallback(
    async (questionId: string, answers: ToolQuestionAnswer[]) => {
      if (options.humanInput === undefined) throw new Error("useChat humanInput is not configured");
      if (answeringQuestionsRef.current.has(questionId)) return;
      const version = humanInputVersionRef.current;
      const pending = new Set(answeringQuestionsRef.current).add(questionId);
      answeringQuestionsRef.current = pending;
      setAnsweringQuestions(pending);
      try {
        const question = questionsRef.current.find((item) => item.id === questionId);
        const input: ToolQuestionAnswerInput = {
          questionId,
          answers,
          ...(question === undefined ? {} : { question }),
        };
        const result =
          options.humanInput.answerQuestion === undefined
            ? await defaultAnswerQuestion(input, options.humanInput)
            : await options.humanInput.answerQuestion(input);
        if (result !== undefined && humanInputVersionRef.current === version)
          updateQuestion(result);
      } finally {
        if (humanInputVersionRef.current === version) {
          const next = new Set(answeringQuestionsRef.current);
          next.delete(questionId);
          answeringQuestionsRef.current = next;
          setAnsweringQuestions(next);
        }
      }
    },
    [options.humanInput, updateQuestion],
  );

  const reset = useCallback(
    (nextMessages: UIMessage[] = []) => {
      abortRef.current?.abort();
      abortRef.current = undefined;
      clearResumeState();
      updateMessages(nextMessages);
      setContextUsage(contextUsageFromMessages(nextMessages));
      setEvents([]);
      clearHumanInput();
      setError(undefined);
      setStatus("ready");
      setIsResuming(false);
    },
    [clearHumanInput, clearResumeState, updateMessages],
  );

  return {
    messages,
    events,
    contextUsage,
    suggestions: options.suggestions ?? [],
    setMessages,
    sendMessage,
    send: async (input = "") => sendMessage(input),
    regenerate,
    stop,
    reset,
    status,
    error,
    text: assistantText(messages),
    streamId,
    isResuming,
    resume,
    humanInput: {
      approvals: { all: approvals, pending: approvals.filter((item) => item.status === "pending") },
      questions: { all: questions, pending: questions.filter((item) => item.status === "pending") },
    },
    decidingApprovals: new Set(decidingApprovals),
    answeringQuestions: new Set(answeringQuestions),
    approveTool: async (approvalId, reason) => decideToolApproval(approvalId, true, reason),
    rejectTool: async (approvalId, reason) => decideToolApproval(approvalId, false, reason),
    answerToolQuestion,
  };
}

type SendMessagesRunOptions = { resume?: ClientStreamCursor; isResuming?: boolean };

function findLastUserIndex(messages: UIMessage[]): number {
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
