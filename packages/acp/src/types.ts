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
  config: AcpSessionConfig;
  signal: AbortSignal;
}>;

export type AcpToolPresentation = Readonly<{
  title?: string;
  /** Explicit display text for tool updates and approval requests. */
  text?: string;
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
  /** Explicit proposed edits, never inferred from arbitrary tool arguments. */
  diffs?: readonly Readonly<{ path: string; oldText?: string | null; newText: string }>[];
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
  /** Created by @anvia/acp/durable; omitted for ephemeral execution. */
  driver?: import("./driver.js").AcpDurableDriver;
  turnBudget?: AcpTurnBudget;
  /** In read-only mode, every non-editor tool must be explicitly classified here.
   * The host must also exclude provider-side effects and dynamic execution paths. */
  readOnlyTools?: readonly string[];
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
  /** Inbound RPCs awaiting a response, across the connection. */
  maxConcurrentRequests: number;
  maxTerminalOutputBytes: number;
  /** One v1 session/load replay, checked before any replay is sent. */
  maxReplayBatchEntries: number;
  maxReplayBatchBytes: number;
}>;

/** Normalized editor declaration, validated before any server is started. */
export type AcpMcpServer = Readonly<
  | {
      type: "stdio";
      name: string;
      command: string;
      args: readonly string[];
      env: Readonly<Record<string, string>>;
    }
  | { type: "http"; name: string; url: string; headers: Readonly<Record<string, string>> }
>;

export type AcpMcpOptions = Readonly<{
  /** Privileged process launch. Requires authorizeServer approval too. Default: false. */
  stdio?: boolean;
  /** Enable tested Streamable HTTP support and advertise it. Defaults to false. */
  http?: boolean;
  /** Exact URLs with host-approved IPs; no editor-controlled trust or DNS expansion. */
  trustedHttpEndpoints?: readonly Readonly<{ url: string; addresses: readonly string[] }>[];
  /** Host approval for each declaration, before any connections. Must return true.
   * Required for stdio; optional additional restriction for opt-in HTTP. */
  authorizeServer?: (
    server: AcpMcpServer,
    context: Readonly<{ cwd: string; signal: AbortSignal }>,
  ) => boolean | Promise<boolean>;
}>;

export type AcpOptions = Readonly<{
  /** Return a fresh Agent for ephemeral sessions, or a host-owned durable binding. */
  sessionFactory: AcpSessionFactory;
  /** Defaults to isolated in-memory storage. Supply a store for cross-connection restore. */
  sessionStore?: import("./session-store.js").AcpSessionStore;
  agentInfo?: AcpAgentInfo;
  /** Maximum bytes per incoming NDJSON message; defaults to 10 MiB. */
  maxMessageBytes?: number;
  /** Images require explicit opt-in and an image-capable model in every session. */
  images?: boolean;
  /** Forward plaintext reasoning deltas only. Defaults to false; signatures stay private. */
  reasoning?: boolean;
  mcp?: AcpMcpOptions;
  /** Explicit opt-in, intersected with client capabilities. No local fallback. */
  editorTools?: Partial<AcpSessionPolicy["editorTools"]>;
  /** Expose the read-only permission preset. The factory must honor it. */
  readOnlyMode?: boolean;
  /** Host-owned model identifiers. First entry is the default; no credentials on the wire. */
  models?: readonly Readonly<{ value: string; name: string }>[];
  /** Text resource payloads only, no URI fetching. Defaults to false. */
  embeddedContext?: boolean;
  /** Pure prompt expansions. Unknown slash commands remain ordinary user text. */
  commands?: readonly AcpCommand[];
  /** Session admission roots. Does not widen editor file/terminal access beyond cwd. */
  workspaceRoots?: readonly string[];
  /** Additional existing absolute directories accessible to editor tools. Privileged host policy. */
  editorWorkspaceRoots?: readonly string[];
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
  /** Idempotent. Aborts ephemeral work, detaches durable work, and releases connection resources. */
  close: () => Promise<void>;
}>;

export type AcpSessionConfig = Readonly<{ mode: "ask" | "read-only"; model?: string }>;

export type AcpCommand = Readonly<{
  name: string;
  description: string;
  inputHint?: string;
  /** Runs inside the prompt lock. Its output is validated against normal prompt limits. */
  expand: (argumentsText: string, context: AcpSessionContext) => string;
}>;
