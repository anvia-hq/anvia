import { Box, Text, useApp, useInput, useStdout } from "ink";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { streamAssistantResponse } from "./agent.js";
import { buildTranscriptLines, TranscriptLineView } from "./components/transcript.js";
import { getModelName, getOpenRouterApiKey } from "./config.js";
import type { AssistantMessagePart, ChatMessage } from "./types.js";

const STREAMING_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export function App() {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [status, setStatus] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingFrameIndex, setStreamingFrameIndex] = useState(0);
  const [scrollOffset, setScrollOffset] = useState(0);
  const nextId = useRef(1);
  const messagesRef = useRef(messages);
  const inputRef = useRef(input);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    inputRef.current = input;
  }, [input]);

  useEffect(() => {
    if (!isStreaming) {
      setStreamingFrameIndex(0);
      return;
    }

    const interval = setInterval(() => {
      setStreamingFrameIndex((current) => (current + 1) % STREAMING_FRAMES.length);
    }, 80);

    return () => {
      clearInterval(interval);
    };
  }, [isStreaming]);

  const sendMessage = useCallback(
    async (content: string) => {
      const prompt = content.trim();
      if (prompt.length === 0 || isStreaming) {
        return;
      }

      const apiKey = getOpenRouterApiKey();
      if (apiKey === undefined || apiKey.length === 0) {
        setStatus("Set OPENROUTER_API_KEY before running the CLI.");
        return;
      }

      const userMessage: ChatMessage = {
        id: nextId.current++,
        role: "user",
        content: prompt,
      };
      let activeAssistantId: number | undefined;

      const ensureAssistantMessage = () => {
        if (activeAssistantId !== undefined) {
          return activeAssistantId;
        }

        const id = nextId.current++;
        activeAssistantId = id;
        setMessages((current) => [
          ...current,
          {
            id,
            role: "assistant",
            parts: [],
          },
        ]);
        return id;
      };

      const appendAssistantPart = (part: AssistantMessagePart) => {
        const assistantId = ensureAssistantMessage();
        setMessages((current) =>
          current.map((message) => {
            if (message.id !== assistantId || message.role !== "assistant") {
              return message;
            }

            const lastPart = message.parts.at(-1);
            if (
              lastPart !== undefined &&
              lastPart.type === part.type &&
              (lastPart.type === "text" || lastPart.type === "reasoning") &&
              (part.type === "text" || part.type === "reasoning")
            ) {
              return {
                ...message,
                parts: [
                  ...message.parts.slice(0, -1),
                  {
                    ...lastPart,
                    content: `${lastPart.content}${part.content}`,
                  },
                ],
              };
            }

            return {
              ...message,
              parts: [...message.parts, part],
            };
          }),
        );
      };

      setInput("");
      setStatus("");
      setIsStreaming(true);
      setMessages((current) => [...current, userMessage]);

      try {
        await streamAssistantResponse({
          apiKey,
          prompt,
          history: messagesRef.current,
          onDelta: (delta) => {
            appendAssistantPart({
              type: "text",
              content: delta,
            });
          },
          onReasoningDelta: (delta) => {
            appendAssistantPart({
              type: "reasoning",
              content: delta,
            });
          },
          onToolCall: ({ id, callId, name, args }) => {
            appendAssistantPart({
              type: "tool_call",
              id,
              toolName: name,
              args,
              ...(callId === undefined ? {} : { callId }),
            });
          },
          onToolResult: ({ id, callId, name, result }) => {
            appendAssistantPart({
              type: "tool_result",
              id,
              toolName: name,
              result,
              ...(callId === undefined ? {} : { callId }),
            });
          },
        });
      } catch (caught) {
        appendAssistantPart({
          type: "text",
          content: caught instanceof Error ? caught.message : String(caught),
        });
        setStatus("Request failed.");
      } finally {
        setIsStreaming(false);
      }
    },
    [isStreaming],
  );

  const terminalHeight = stdout.rows ?? 24;
  const terminalWidth = stdout.columns ?? 80;
  const historyHeight = Math.max(3, terminalHeight - 7);
  const transcriptLines = useMemo(
    () => buildTranscriptLines(messages, terminalWidth - 4),
    [messages, terminalWidth],
  );
  const maxScrollOffset = Math.max(0, transcriptLines.length - historyHeight);
  const transcriptStart = Math.max(0, transcriptLines.length - historyHeight - scrollOffset);
  const visibleTranscriptLines = transcriptLines.slice(
    transcriptStart,
    transcriptStart + historyHeight,
  );
  const inputPreview = isStreaming ? input : `${input}_`;
  const streamingStatus = `${STREAMING_FRAMES[streamingFrameIndex]} Streaming...`;
  const scrollStatus =
    scrollOffset > 0 ? `History ${maxScrollOffset - scrollOffset + 1}/${maxScrollOffset + 1}` : "";

  useEffect(() => {
    setScrollOffset((current) => Math.min(current, maxScrollOffset));
  }, [maxScrollOffset]);

  useInput((typed, key) => {
    if (key.ctrl && typed === "c") {
      exit();
      return;
    }

    if (key.upArrow || key.pageUp || key.home) {
      setScrollOffset((current) => {
        if (key.home) {
          return maxScrollOffset;
        }

        const delta = key.pageUp ? historyHeight : 1;
        return Math.min(maxScrollOffset, current + delta);
      });
      return;
    }

    if (key.downArrow || key.pageDown || key.end) {
      setScrollOffset((current) => {
        if (key.end) {
          return 0;
        }

        const delta = key.pageDown ? historyHeight : 1;
        return Math.max(0, current - delta);
      });
      return;
    }

    if (key.return) {
      setScrollOffset(0);
      void sendMessage(inputRef.current);
      return;
    }

    if (key.backspace || key.delete) {
      setInput((current) => current.slice(0, -1));
      return;
    }

    if (
      typed.length > 0 &&
      !key.ctrl &&
      !key.meta &&
      !key.upArrow &&
      !key.downArrow &&
      !key.leftArrow &&
      !key.rightArrow
    ) {
      if (typed.includes("\n") || typed.includes("\r")) {
        const [beforeReturn = ""] = typed.split(/\r?\n/);
        const nextInput = inputRef.current + beforeReturn;
        setInput(nextInput);
        inputRef.current = nextInput;
        void sendMessage(nextInput);
        return;
      }

      setInput((current) => current + typed);
    }
  });

  return (
    <Box flexDirection="column" height={terminalHeight} width={terminalWidth}>
      <Box borderStyle="single" paddingX={1}>
        <Text color="cyan">anvia-cli-agent</Text>
        <Text dimColor> / </Text>
        <Text dimColor>{getModelName()}</Text>
      </Box>

      <Box flexDirection="column" height={historyHeight} overflow="hidden" paddingX={1}>
        {visibleTranscriptLines.length === 0 ? (
          <Text dimColor>Start a conversation below.</Text>
        ) : (
          visibleTranscriptLines.map((line) => <TranscriptLineView key={line.key} line={line} />)
        )}
      </Box>

      <Box borderStyle="single" flexShrink={0} paddingX={1}>
        <Text color="green">› </Text>
        <Text>{inputPreview}</Text>
      </Box>

      <Box flexShrink={0} height={1} paddingX={1}>
        <Text dimColor>{status || scrollStatus || (isStreaming ? streamingStatus : "")}</Text>
      </Box>
    </Box>
  );
}
