import type { IOType } from "node:child_process";
import type { Stream } from "node:stream";
import type { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import type { StreamableHTTPReconnectionOptions } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";

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
  readonly tools?: {
    readonly prefix?: string | undefined;
  };
};

export type McpConnectOptions = {
  readonly abortSignal?: AbortSignal | undefined;
};

export type McpClientGroupConnectOptions = {
  readonly clients: readonly import("./client").McpClient[];
  readonly abortSignal?: AbortSignal | undefined;
};
