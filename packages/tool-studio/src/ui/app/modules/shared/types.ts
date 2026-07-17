import type {
  StudioTrace,
  StudioTranscriptChatEntry,
  StudioTranscriptEntry,
} from "../../../../types";

export type PendingAssistantMessage = Omit<StudioTranscriptChatEntry, "role" | "text" | "tone"> & {
  role: "assistant";
  text: "";
  tone: "pending";
};
export type TranscriptEntry = StudioTranscriptEntry | PendingAssistantMessage;
export type ChatMessage = Extract<TranscriptEntry, { kind: "message" }>;
export type ToolMessage = Extract<TranscriptEntry, { kind: "tool" }>;
export type ToolApproval = NonNullable<ToolMessage["approval"]>;
export type ToolApprovalUpdate = ToolApproval & {
  toolName: string;
  callId?: string;
};
export type ToolQuestion = NonNullable<ToolMessage["question"]>;
export type ToolQuestionUpdate = ToolQuestion & {
  toolName: string;
  callId?: string;
};
export type TraceObservationItem = StudioTrace["observations"][number];
export type RunState = "idle" | "running";
export type SessionLoadState = "idle" | "loading";
export type TraceLoadState = "idle" | "loading";
export type ActivePage =
  | "playground"
  | "tracing"
  | "sessions"
  | "agents"
  | "tools"
  | "sandboxes"
  | "mcps"
  | "pipelines"
  | "evals"
  | "memory"
  | "status"
  | "knowledge";
export type KnowledgeTab = "static-context" | "dynamic-context" | "dynamic-tools" | "retrieval-log";
export type TraceStatusFilter = "all" | StudioTrace["status"];
export type TraceInspectorKey = "trace" | "agent" | `turn:${number}` | `observation:${string}`;
export type PageLocation = {
  page: ActivePage;
  sessionId?: string;
  traceId?: string;
  traceSessionId?: string;
  knowledgeTab?: KnowledgeTab;
};
