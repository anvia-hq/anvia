import type { ChangeEvent, KeyboardEvent, RefObject } from "react";
import { createContext, useContext } from "react";
import type {
  StudioConfig,
  StudioModelSummary,
  StudioSessionSummary,
  StudioTraceSummary,
} from "../../types";
import type { PromptAttachment } from "./app-helpers";
import type { StudioTheme } from "./app-theme";
import type { useStudioSessions } from "./modules/sessions/use-studio-sessions";
import type { ActivePage, KnowledgeTab, RunState, TranscriptEntry } from "./modules/shared/types";
import type { useTraces } from "./modules/tracing/use-traces";

type StudioSessionsController = ReturnType<typeof useStudioSessions>;
type StudioTracesController = ReturnType<typeof useTraces>;

export type StudioConsoleContextValue = {
  activePage: ActivePage;
  agents: StudioConfig["agents"];
  answeringQuestions: Set<string>;
  attachments: PromptAttachment[];
  decidingApprovals: Set<string>;
  deleteCandidate: StudioSessionSummary | undefined;
  evals: StudioConfig["evals"];
  evalsEnabled: boolean;
  hasAgents: boolean;
  hasMessages: boolean;
  isStreaming: boolean;
  workingStartedAt: number | undefined;
  knowledgeEnabled: boolean;
  knowledgeTab: KnowledgeTab;
  mcpsEnabled: boolean;
  memoryEnabled: boolean;
  messages: TranscriptEntry[];
  pageEnabled: (page: ActivePage) => boolean;
  pipelines: StudioConfig["pipelines"];
  pipelinesEnabled: boolean;
  prompt: string;
  runState: RunState;
  selectedAgent: StudioConfig["agents"][number] | undefined;
  selectedAgentId: string;
  selectedAgentModels: StudioModelSummary[];
  selectedAgentQuickPrompts: string[];
  selectedModelRef: string;
  sessionTraceSummaries: StudioTraceSummary[];
  sessions: StudioSessionsController;
  sessionsEnabled: boolean;
  status: string;
  statusEnabled: boolean;
  theme: StudioTheme;
  toolsEnabled: boolean;
  traces: StudioTracesController;
  tracesEnabled: boolean;
  attachmentInputRef: RefObject<HTMLInputElement | null>;
  promptRef: RefObject<HTMLTextAreaElement | null>;
  transcriptScrollerRef: RefObject<HTMLElement | null>;
  activateRoute: (page: ActivePage) => void;
  navigateFallback: (preferred: ActivePage) => void;
  navigatePage: (page: ActivePage) => void;
  navigateKnowledgeTab: (tab: KnowledgeTab) => void;
  setDeleteCandidate: (session: StudioSessionSummary | undefined) => void;
  setError: (message: string) => void;
  setKnowledgeTab: (tab: KnowledgeTab) => void;
  setSelectedModelRef: (modelRef: string) => void;
  setStatus: (status: string) => void;
  startNewChat: (options?: { updatePath?: boolean }) => void;
  selectPlaygroundAgent: (agentId: string) => void;
  addPromptAttachments: (event: ChangeEvent<HTMLInputElement>) => void;
  decideToolApproval: (approvalId: string, approved: boolean) => void;
  updatePrompt: (event: ChangeEvent<HTMLTextAreaElement>) => void;
  handlePromptKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  answerToolQuestion: (
    questionId: string,
    answers: Array<{ questionId: string; answer: string; choice?: string; custom?: boolean }>,
  ) => void;
  removePromptAttachment: (id: string) => void;
  runPrompt: (prompt: string) => void;
  stopPrompt: () => void;
  toggleTheme: () => void;
  updateTranscriptStickiness: () => void;
};

export const StudioConsoleContext = createContext<StudioConsoleContextValue | undefined>(undefined);

export function useStudioConsole(): StudioConsoleContextValue {
  const value = useContext(StudioConsoleContext);
  if (value === undefined) {
    throw new Error("StudioConsoleContext is missing");
  }
  return value;
}
