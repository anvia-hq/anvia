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

/** Session creation contract; session execution is introduced after the transport scaffold. */
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

export type AcpOptions = Readonly<{
  /** Loaded now, invoked only once session/new is implemented. */
  sessionFactory: AcpSessionFactory;
  agentInfo?: AcpAgentInfo;
  /** Maximum bytes per incoming NDJSON message; defaults to 10 MiB. */
  maxMessageBytes?: number;
}>;

export type AcpConnectionOptions = AcpOptions &
  Readonly<{
    input: ReadableStream<Uint8Array>;
    output: WritableStream<Uint8Array>;
  }>;

export type AcpConnection = Readonly<{
  /** Resolves on input EOF, transport failure, or explicit close. */
  closed: Promise<void>;
  /** Idempotent. Cancels the input reader; does not close caller-owned output. */
  close: () => Promise<void>;
}>;
