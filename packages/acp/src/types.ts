import type { Usage, ToolCallPart } from "@anvia/core/completion";
import type { Agent } from "@anvia/core/agent";
import type { McpServer } from "@anvia/core/mcp";
import type { AnyTool } from "@anvia/core/tool";
import type { ReadableStream, WritableStream } from "node:stream/web";

export type AcpClientCapabilities = Readonly<{
  readTextFile: boolean;
  writeTextFile: boolean;
  terminal: boolean;
  elicitationForm: boolean;
}>;

export type AcpSessionPolicy = Readonly<{
  permissionPreset: "ask" | "read-only";
  workspaceRoots: readonly string[];
  editorTools: Readonly<{
    readTextFile: boolean;
    writeTextFile: boolean;
    terminal: boolean;
  }>;
}>;

/** Immutable, session-local creation context. Resolve tool paths against cwd, never process.chdir. */
export type AcpSessionContext = Readonly<{
  sessionId: string;
  cwd: string;
  clientCapabilities: AcpClientCapabilities;
  policy: AcpSessionPolicy;
  mcpServers: readonly McpServer[];
  editorTools: readonly AnyTool[];
  signal: AbortSignal;
}>;

export type AcpToolPresentation = Readonly<{
  title?: string;
  kind?:
    | "read"
    | "edit"
    | "delete"
    | "move"
    | "search"
    | "execute"
    | "think"
    | "fetch"
    | "switch_mode"
    | "other";
  /** Display-only paths, resolved against the session cwd; lines are one-based. */
  locations?: readonly Readonly<{ path: string; line?: number }>[];
}>;

/** One budget shared by every continuation segment of an ACP prompt. */
export type AcpTurnBudget = Readonly<{
  /** Logical model generations; defaults to agent.defaultMaxTurns + 1. */
  maxModelCalls?: number;
  /** Wall time including time spent waiting for the user. No deadline by default. */
  maxDurationMs?: number;
  /** Host-defined cost units; requires estimateCost. No cost ceiling by default. */
  maxCost?: number;
  /** Estimate cumulative cost from cumulative usage across all segments. */
  estimateCost?: (usage: Usage) => number;
}>;

export type AcpSessionBinding = Readonly<{
  agent: Agent;
  turnBudget?: AcpTurnBudget;
  /** Trusted display projection. Never return credentials or private tool arguments. */
  toolPresentation?: (call: ToolCallPart) => AcpToolPresentation | undefined;
  dispose?: () => void | Promise<void>;
}>;

export type AcpSessionFactory = (
  context: AcpSessionContext,
) => AcpSessionBinding | Promise<AcpSessionBinding>;

export type AcpAgentInfo = Readonly<{
  name: string;
  version: string;
  title?: string;
}>;

export type AcpLimits = Readonly<{
  maxSessions: number;
  maxPromptBytes: number;
  maxTextBytes: number;
  maxImageBytes: number;
  maxContentBlocks: number;
  maxHistoryBytes: number;
  maxHistoryMessages: number;
  maxPendingRequests: number;
}>;

export type AcpOptions = Readonly<{
  /** Called once per session. Must return a fresh Agent without separately configured memory. */
  sessionFactory: AcpSessionFactory;
  agentInfo?: AcpAgentInfo;
  /** Maximum bytes per incoming NDJSON message; defaults to 10 MiB. */
  maxMessageBytes?: number;
  /** Images require explicit opt-in and an image-capable model in every session. */
  images?: boolean;
  /** Forward plaintext reasoning deltas only. Defaults to false; signatures stay private. */
  reasoning?: boolean;
  /** Existing absolute directories; canonical containment is checked before calling the factory. */
  workspaceRoots?: readonly string[];
  /** Positive integer resource bounds. See README for defaults. */
  limits?: Partial<AcpLimits>;
}>;

export type AcpConnectionOptions = AcpOptions &
  Readonly<{
    input: ReadableStream<Uint8Array>;
    output: WritableStream<Uint8Array>;
  }>;

export type AcpConnection = Readonly<{
  /** Resolves after session cleanup on input EOF, transport failure, or explicit close. */
  closed: Promise<void>;
  /** Idempotent. Aborts session work and disposes bindings; does not close caller-owned output. */
  close: () => Promise<void>;
}>;
