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

export type AcpSessionBinding = Readonly<{
  agent: Agent;
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
