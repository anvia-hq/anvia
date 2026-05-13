import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type {
  McpClient,
  McpConnection,
  McpHttpOptions,
  McpSseOptions,
  McpStdioOptions,
} from "./types";

export const mcp = {
  stdio(options: McpStdioOptions): McpConnection {
    return {
      name: options.name,
      async connect(): Promise<McpClient> {
        const { name: _name, ...server } = options;
        const client = createSdkClient();
        await client.connect(asSdkTransport(new StdioClientTransport(server)));
        return client as McpClient;
      },
    };
  },

  http(options: McpHttpOptions): McpConnection {
    return {
      name: options.name,
      async connect(): Promise<McpClient> {
        const client = createSdkClient();
        await client.connect(
          asSdkTransport(
            new StreamableHTTPClientTransport(new URL(options.url), options.transport),
          ),
        );
        return client as McpClient;
      },
    };
  },

  sse(options: McpSseOptions): McpConnection {
    return {
      name: options.name,
      async connect(): Promise<McpClient> {
        const client = createSdkClient();
        await client.connect(
          asSdkTransport(new SSEClientTransport(new URL(options.url), options.transport)),
        );
        return client as McpClient;
      },
    };
  },
};

function createSdkClient(): Client {
  return new Client({
    name: "@anvia/core",
    version: "0.1.0",
  });
}

function asSdkTransport(transport: unknown): Parameters<Client["connect"]>[0] {
  return transport as Parameters<Client["connect"]>[0];
}
