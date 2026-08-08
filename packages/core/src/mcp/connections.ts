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
        validateMcpUrl(options.url);
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
        validateMcpUrl(options.url);
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

function validateMcpUrl(url: string | URL): void {
  let parsed: URL;
  try {
    parsed = typeof url === "string" ? new URL(url) : url;
  } catch {
    throw new Error(`Invalid MCP URL: ${url}`);
  }

  const hostname = parsed.hostname.toLowerCase();

  // Block localhost and loopback addresses
  if (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    hostname === "[::1]" ||
    hostname.startsWith("127.")
  ) {
    throw new Error(`MCP URL blocked: localhost not allowed (${hostname})`);
  }

  // Block cloud metadata endpoints first (more specific)
  if (
    hostname === "169.254.169.254" ||
    hostname === "fd00:ec2::254" ||
    hostname === "[fd00:ec2::254]"
  ) {
    throw new Error(`MCP URL blocked: cloud metadata endpoint not allowed (${hostname})`);
  }

  const privateIPv4Patterns = [
    /^10\./,
    /^172\.(1[6-9]|2[0-9]|3[0-1])\./,
    /^192\.168\./,
    /^169\.254\./,
  ];

  if (privateIPv4Patterns.some((pattern) => pattern.test(hostname))) {
    throw new Error(`MCP URL blocked: private IP range not allowed (${hostname})`);
  }

  // Block link-local IPv6 ranges
  const privateIPv6Patterns = [
    /^\[?fe80:/i, // Link-local (with or without brackets)
    /^\[?fc00:/i, // Unique local
    /^\[?fd00:/i, // Unique local
  ];

  if (privateIPv6Patterns.some((pattern) => pattern.test(hostname))) {
    throw new Error(`MCP URL blocked: private IPv6 range not allowed (${hostname})`);
  }
}
