import { uiMessagesToCoreMessages } from "@anvia/core";
import type { UIMessage, UIStreamEvent, UIStreamRequest } from "@anvia/core/ui";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  defaultAnswerQuestion,
  defaultDecideApproval,
  defaultEventToApproval,
  defaultEventToQuestion,
  upsertById,
} from "./human-input";
import { createChatTransport } from "./transport";
import type {
  CreateChatRequestArgs,
  EventTransport,
  SendMessageInput,
  ToolApproval,
  ToolQuestion,
  ToolQuestionAnswer,
  UseChatOptions,
  UseChatResult,
} from "./types";
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
  const [approvals, setApprovals] = useState<ToolApproval[]>([]);
  const [questions, setQuestions] = useState<ToolQuestion[]>([]);
  const [decidingApprovals, setDecidingApprovals] = useState<Set<string>>(() => new Set());
  const [answeringQuestions, setAnsweringQuestions] = useState<Set<string>>(() => new Set());
  const abortRef = useRef<AbortController | undefined>(undefined);
  const messagesRef = useRef(messages);
  const approvalsRef = useRef(approvals);
  const questionsRef = useRef(questions);
  const decidingApprovalsRef = useRef(decidingApprovals);
  const answeringQuestionsRef = useRef(answeringQuestions);
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
    decidingApprovalsRef.current = decidingApprovals;
  }, [decidingApprovals]);

  useEffect(() => {
    answeringQuestionsRef.current = answeringQuestions;
  }, [answeringQuestions]);

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
    const next =
      typeof nextMessages === "function" ? nextMessages(messagesRef.current) : nextMessages;
    messagesRef.current = next;
    setMessagesState(next);
  }, []);

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
    (event: TEvent) => {
      const mappedUIEvent = options.eventToUIEvent?.(event);
      if (mappedUIEvent !== undefined) {
        setMessages((current) => applyUIStreamEvent(current, mappedUIEvent));
        return;
      }

      const hasCustomEventMapper =
        options.eventToUIEvent !== undefined ||
        options.eventToDelta !== undefined ||
        options.eventToFinal !== undefined;

      if (!hasCustomEventMapper) {
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

  const applyHumanInputEvent = useCallback(
    (event: TEvent) => {
      const humanInputOptions = options.humanInput;
      if (humanInputOptions === undefined) {
        return;
      }

      const eventToApproval = humanInputOptions.eventToApproval ?? defaultEventToApproval<TEvent>;
      const approval = eventToApproval(event);
      if (approval !== undefined) {
        updateApproval(approval);
      }

      const eventToQuestion = humanInputOptions.eventToQuestion ?? defaultEventToQuestion<TEvent>;
      const question = eventToQuestion(event);
      if (question !== undefined) {
        updateQuestion(question);
      }
    },
    [options.humanInput, updateApproval, updateQuestion],
  );

  const sendMessages = useCallback(
    async (nextMessages: UIMessage[]) => {
      if (transport === undefined) {
        throw new Error("useChat requires either transport or endpoint");
      }

      abortRef.current?.abort();
      const abortController = new AbortController();
      abortRef.current = abortController;

      const createRequest =
        options.createRequest ??
        ((args: CreateChatRequestArgs) =>
          ({ messages: args.coreMessages, stream: true }) as TRequest);

      setMessages(nextMessages);
      setEvents([]);
      setError(undefined);
      clearHumanInput();
      setStatus("streaming");

      try {
        const coreMessages = uiMessagesToCoreMessages(nextMessages);
        const request = createRequest({
          messages: nextMessages,
          uiMessages: nextMessages,
          coreMessages,
        });

        for await (const event of transport.send(request, { signal: abortController.signal })) {
          if (abortRef.current !== abortController || abortController.signal.aborted) {
            return;
          }
          setEvents((current) => [...current, event]);
          applyHumanInputEvent(event);
          options.onEvent?.(event);
          if (abortRef.current !== abortController || abortController.signal.aborted) {
            return;
          }
          applyEvent(event);
        }

        if (abortRef.current === abortController && !abortController.signal.aborted) {
          setStatus("idle");
        }
      } catch (caught) {
        if (isAbortError(caught)) {
          if (abortRef.current === abortController) {
            setStatus("idle");
          }
          return;
        }
        if (abortRef.current !== abortController) {
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
    [applyEvent, applyHumanInputEvent, clearHumanInput, options, setMessages, transport],
  );

  const sendMessage = useCallback(
    async (input: SendMessageInput) => {
      const message = createUserMessage(input);
      if (message === undefined) {
        return;
      }
      const currentMessages = messagesRef.current;
      const baseMessages =
        abortRef.current !== undefined && currentMessages.at(-1)?.role === "assistant"
          ? currentMessages.slice(0, -1)
          : currentMessages;
      await sendMessages([...baseMessages, message]);
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

  const decideToolApproval = useCallback(
    async (approvalId: string, approved: boolean, reason?: string) => {
      const humanInputOptions = options.humanInput;
      if (humanInputOptions === undefined) {
        throw new Error("useChat humanInput is not configured");
      }
      if (decidingApprovalsRef.current.has(approvalId)) {
        return;
      }

      const humanInputVersion = humanInputVersionRef.current;
      const nextDeciding = new Set(decidingApprovalsRef.current).add(approvalId);
      decidingApprovalsRef.current = nextDeciding;
      setDecidingApprovals(nextDeciding);
      try {
        const approval = approvalsRef.current.find((item) => item.id === approvalId);
        const input = {
          approvalId,
          approved,
          ...(reason === undefined ? {} : { reason }),
          ...(approval === undefined ? {} : { approval }),
        };
        const result =
          humanInputOptions.decideApproval === undefined
            ? await defaultDecideApproval(input, humanInputOptions)
            : await humanInputOptions.decideApproval(input);
        if (result !== undefined && humanInputVersionRef.current === humanInputVersion) {
          updateApproval(result);
        }
      } finally {
        if (humanInputVersionRef.current === humanInputVersion) {
          const next = new Set(decidingApprovalsRef.current);
          next.delete(approvalId);
          decidingApprovalsRef.current = next;
          setDecidingApprovals(next);
        }
      }
    },
    [options.humanInput, updateApproval],
  );

  const approveTool = useCallback(
    async (approvalId: string, reason?: string) => {
      await decideToolApproval(approvalId, true, reason);
    },
    [decideToolApproval],
  );

  const rejectTool = useCallback(
    async (approvalId: string, reason?: string) => {
      await decideToolApproval(approvalId, false, reason);
    },
    [decideToolApproval],
  );

  const answerToolQuestion = useCallback(
    async (questionId: string, answers: ToolQuestionAnswer[]) => {
      const humanInputOptions = options.humanInput;
      if (humanInputOptions === undefined) {
        throw new Error("useChat humanInput is not configured");
      }
      if (answeringQuestionsRef.current.has(questionId)) {
        return;
      }

      const humanInputVersion = humanInputVersionRef.current;
      const nextAnswering = new Set(answeringQuestionsRef.current).add(questionId);
      answeringQuestionsRef.current = nextAnswering;
      setAnsweringQuestions(nextAnswering);
      try {
        const question = questionsRef.current.find((item) => item.id === questionId);
        const input = {
          questionId,
          answers,
          ...(question === undefined ? {} : { question }),
        };
        const result =
          humanInputOptions.answerQuestion === undefined
            ? await defaultAnswerQuestion(input, humanInputOptions)
            : await humanInputOptions.answerQuestion(input);
        if (result !== undefined && humanInputVersionRef.current === humanInputVersion) {
          updateQuestion(result);
        }
      } finally {
        if (humanInputVersionRef.current === humanInputVersion) {
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
      setMessages(nextMessages);
      setEvents([]);
      clearHumanInput();
      setError(undefined);
      setStatus("idle");
    },
    [clearHumanInput, setMessages],
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
    humanInput: {
      approvals: {
        all: approvals,
        pending: approvals.filter((approval) => approval.status === "pending"),
      },
      questions: {
        all: questions,
        pending: questions.filter((question) => question.status === "pending"),
      },
    },
    decidingApprovals: new Set(decidingApprovals),
    answeringQuestions: new Set(answeringQuestions),
    approveTool,
    rejectTool,
    answerToolQuestion,
  };
}

function findLastUserIndex(messages: UIMessage[]): number {
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
