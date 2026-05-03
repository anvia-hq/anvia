export type UserMessage = {
  id: number;
  role: "user";
  content: string;
};

export type AssistantMessage = {
  id: number;
  role: "assistant";
  parts: AssistantMessagePart[];
};

export type AssistantMessagePart =
  | {
      type: "reasoning";
      content: string;
    }
  | {
      type: "text";
      content: string;
    }
  | {
      type: "tool_call";
      toolName: string;
      id: string;
      callId?: string;
      args: unknown;
    }
  | {
      type: "tool_result";
      toolName: string;
      id: string;
      callId?: string;
      result: string;
    };

export type ChatMessage = UserMessage | AssistantMessage;

export type TranscriptLine =
  | {
      key: string;
      type: "badge";
      label: string;
      color: "green" | "cyan" | "yellow";
    }
  | {
      key: string;
      type: "text";
      content: string;
      dimColor?: boolean;
      color?: "yellow";
    }
  | {
      key: string;
      type: "markdown";
      content: string;
    }
  | {
      key: string;
      type: "spacer";
    };
