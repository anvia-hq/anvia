import type {
  CompletionResponse,
  Message as MessageType,
  ReasoningContentType,
  ToolCall,
  ToolResultContent,
  Usage,
} from "../completion/index";
import type { GuardrailDecisionRecord } from "../guardrails";
import type { AgentTraceInfo } from "../observability/types";

export type PromptResponse = {
  output: string;
  usage: Usage;
  messages: MessageType[];
  trace?: AgentTraceInfo | undefined;
  guardrails?: GuardrailDecisionRecord[] | undefined;
};

export type AgentDeltaEvent =
  | { type: "text_delta"; delta: string }
  | {
      type: "reasoning_delta";
      delta: string;
      id?: string;
      contentType?: ReasoningContentType;
      signature?: string;
    }
  | { type: "tool_call"; toolCall: ToolCall };

export type AgentErrorStreamEvent = {
  type: "error";
  error: unknown;
  usage: Usage;
};

export type AgentChildStreamEvent<RawResponse = unknown> =
  | {
      type: "turn_start";
      turn: number;
      prompt: MessageType;
      history: MessageType[];
    }
  | {
      type: "text_delta";
      turn: number;
      delta: string;
    }
  | {
      type: "reasoning_delta";
      turn: number;
      delta: string;
      id?: string;
      contentType?: ReasoningContentType;
      signature?: string;
    }
  | {
      type: "tool_call";
      turn: number;
      toolCall: ToolCall;
    }
  | {
      type: "tool_result";
      turn: number;
      toolName: string;
      toolCallId?: string;
      internalCallId: string;
      args: string;
      result: string;
      structuredResult?: ToolResultContent[] | undefined;
    }
  | {
      type: "turn_end";
      turn: number;
      response: CompletionResponse<RawResponse>;
    }
  | {
      type: "guardrail_decision";
      turn?: number | undefined;
      decision: GuardrailDecisionRecord;
    }
  | {
      type: "final";
      runId: string;
      output: string;
      usage: Usage;
      messages: MessageType[];
      trace?: AgentTraceInfo | undefined;
      guardrails?: GuardrailDecisionRecord[] | undefined;
    }
  | AgentErrorStreamEvent;

export type AgentStreamEvent<RawResponse = unknown> =
  | AgentChildStreamEvent<RawResponse>
  | {
      type: "agent_tool_event";
      turn: number;
      toolName: string;
      toolCallId?: string;
      internalCallId: string;
      agentId: string;
      agentName?: string;
      event: AgentChildStreamEvent<RawResponse>;
    };
