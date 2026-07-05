import { readFileSync } from "node:fs";
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

const CORE_CLIENT_VERSION = readCorePackageVersion();

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
    version: CORE_CLIENT_VERSION,
  });
}

function readCorePackageVersion(): string {
  try {
    const packageJson = JSON.parse(
      readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
    ) as { version?: unknown };
    return typeof packageJson.version === "string" ? packageJson.version : "0.0.0";
  } catch {
    return "0.0.0";
  }
}

function asSdkTransport(transport: unknown): Parameters<Client["connect"]>[0] {
  return transport as Parameters<Client["connect"]>[0];
}
