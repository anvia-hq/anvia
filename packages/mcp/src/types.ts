import type { IOType } from "node:child_process";
import type { Stream } from "node:stream";
import type {
  OAuthClientProvider,
  StreamableHTTPReconnectionOptions,
  Transport,
  VersionNegotiationOptions,
} from "@modelcontextprotocol/client";

export type { McpServer, McpServerInfo, McpTool } from "@anvia/core/mcp";

export type McpStdioTransport = {
  readonly type: "stdio";
  readonly command: string;
  readonly args?: string[] | undefined;
  readonly env?: Record<string, string> | undefined;
  readonly cwd?: string | undefined;
  readonly stderr?: IOType | Stream | number | undefined;
  readonly maxBufferSize?: number | undefined;
};

export type McpStreamableHttpTransport = {
  readonly type: "streamableHttp";
  readonly url: string | URL;
  readonly ssrfProtection?: "strict" | "disabled" | undefined;
  readonly headers?: Readonly<Record<string, string>> | undefined;
  readonly authProvider?: OAuthClientProvider | undefined;
  readonly reconnectionOptions?: StreamableHTTPReconnectionOptions | undefined;
  readonly sessionId?: string | undefined;
  /** Best-effort legacy session DELETE before closing, bounded to two seconds. Defaults to false. */
  readonly terminateSessionOnClose?: boolean | undefined;
  /**
   * Maximum bytes per JSON-RPC response message: the whole body for JSON
   * responses and each SSE event for event streams. Defaults to 10 MiB,
   * matching the stdio transport's default buffer size.
   */
  readonly maxBufferSize?: number | undefined;
};

export type McpTransport = Transport;

export type McpCustomTransport = {
  readonly type: "custom";
  readonly create: (options: {
    abortSignal?: AbortSignal | undefined;
  }) => McpTransport | Promise<McpTransport>;
};

export type McpClientTransport =
  | McpStdioTransport
  | McpStreamableHttpTransport
  | McpCustomTransport;

export type McpClientOptions = {
  readonly name: string;
  readonly transport: McpClientTransport;
  /**
   * MCP protocol version negotiation. Defaults to pinning the modern `2026-07-28` revision without
   * fallback. Use `mode: "auto"` to allow fallback or `mode: "legacy"` for 2025-era servers.
   */
  readonly versionNegotiation?: VersionNegotiationOptions | undefined;
  readonly tools?: {
    readonly prefix?: string | undefined;
    /** Cumulative decoded tool-page limits, checked before aggregation. Unlimited by default. */
    readonly discoveryLimits?:
      | {
          readonly maxTools: number;
          /** Sum of UTF-8 JSON.stringify(page.tools) bytes, including each page's array syntax. */
          readonly maxBytes: number;
        }
      | undefined;
  };
};

export type McpConnectOptions = {
  readonly abortSignal?: AbortSignal | undefined;
};

export type McpClientGroupConnectOptions = {
  readonly clients: readonly import("./client").McpClient[];
  readonly abortSignal?: AbortSignal | undefined;
};
