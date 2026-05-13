import type { SSEClientTransportOptions } from "@modelcontextprotocol/sdk/client/sse.js";
import type { StdioServerParameters } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { StreamableHTTPClientTransportOptions } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { JsonObject } from "../completion/index";
import type { AnyTool } from "../tool/index";

export type McpToolDefinition = {
  name: string;
  description?: string | undefined;
  inputSchema: JsonObject;
};

export type McpToolCallContent =
  | {
      type: "text";
      text: string;
    }
  | {
      type: "image";
      data: string;
      mimeType: string;
    }
  | {
      type: "resource";
      resource:
        | {
            uri: string;
            text: string;
            mimeType?: string | undefined;
          }
        | {
            uri: string;
            blob: string;
            mimeType?: string | undefined;
          };
    };

export type McpToolCallResult =
  | {
      content: McpToolCallContent[];
      isError?: boolean | undefined;
    }
  | {
      toolResult: unknown;
    };

export type McpClient = {
  listTools(): Promise<{ tools: McpToolDefinition[] }>;
  callTool(params: {
    name: string;
    arguments?: Record<string, unknown>;
  }): Promise<McpToolCallResult>;
  close(): Promise<void>;
};

export type McpConnection = {
  readonly name: string;
  connect(): Promise<McpClient>;
};

export type McpServer = {
  readonly name: string;
  readonly tools: AnyTool[];
  close(): Promise<void>;
};

export type McpStdioOptions = StdioServerParameters & {
  name: string;
};

export type McpHttpOptions = {
  name: string;
  url: string | URL;
  transport?: StreamableHTTPClientTransportOptions | undefined;
};

export type McpSseOptions = {
  name: string;
  url: string | URL;
  transport?: SSEClientTransportOptions | undefined;
};
