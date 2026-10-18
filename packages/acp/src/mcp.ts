import { createHash } from "node:crypto";
import { McpClient, McpClientGroup, type McpClientOptions } from "@anvia/mcp";
import type { McpServer } from "@anvia/core/mcp";
import type { Agent } from "@anvia/core/agent";
import { AcpError } from "./errors.js";
import type { AcpMcpOptions, AcpMcpServer } from "./types.js";

/** Wire-neutral declaration; entry arrays preserve duplicates until validation. */
export type McpDeclaration =
  | {
      type: "stdio";
      name: string;
      command: string;
      args: readonly string[];
      env: readonly { name: string; value: string }[];
    }
  | {
      type: "http" | "sse";
      name: string;
      url: string;
      headers: readonly { name: string; value: string }[];
    };

export function snapshotMcpOptions(options: AcpMcpOptions = {}): AcpMcpOptions {
  const endpoints = options.trustedHttpEndpoints?.map(({ url, addresses }) =>
    Object.freeze({ url: httpUrl(url), addresses: Object.freeze([...addresses]) }),
  );
  if (endpoints && new Set(endpoints.map(({ url }) => url)).size !== endpoints.length) {
    throw new AcpError("configuration_error");
  }
  let snapshot: AcpMcpOptions = { ...options };
  if (endpoints) snapshot = { ...snapshot, trustedHttpEndpoints: Object.freeze(endpoints) };
  return Object.freeze(snapshot);
}

export async function connectSessionMcp(
  declarations: readonly McpDeclaration[],
  options: AcpMcpOptions,
  cwd: string,
  signal: AbortSignal,
): Promise<{ group: McpClientGroup; servers: readonly McpServer[] }> {
  if (declarations.length > 32) throw new AcpError("resource_limit");
  const names = new Set<string>();
  // Finish validation of the entire list before any callback, process or network operation.
  const servers: AcpMcpServer[] = declarations.map((entry) => {
    if (
      !entry.name.trim() ||
      entry.name.length > 256 ||
      /\p{Cc}/u.test(entry.name) ||
      names.has(entry.name)
    ) {
      throw new AcpError("invalid_mcp");
    }
    names.add(entry.name);
    if (entry.type === "stdio") {
      if (
        !entry.command.trim() ||
        entry.command.includes("\0") ||
        entry.args.some((arg) => arg.includes("\0"))
      ) {
        throw new AcpError("invalid_mcp");
      }
      return Object.freeze({
        type: "stdio",
        name: entry.name,
        command: entry.command,
        args: Object.freeze([...entry.args]),
        env: entries(entry.env, false),
      });
    }
    const headers = entries(entry.headers, true);
    if (entry.type !== "http" || !options.http) throw new AcpError("unsupported_mcp");
    return Object.freeze({ type: "http", name: entry.name, url: httpUrl(entry.url), headers });
  });
  const clients: McpClient[] = [];
  // A client capability/declaration is never authorization to execute host code.
  if (
    servers.some((server) => server.type === "stdio") &&
    (options.stdio !== true || !options.authorizeServer)
  )
    throw new AcpError("policy_denied");
  for (const server of servers) {
    signal.throwIfAborted();
    if (
      options.authorizeServer &&
      (await options.authorizeServer(server, Object.freeze({ cwd, signal }))) !== true
    ) {
      throw new AcpError("policy_denied");
    }
    const transport: McpClientOptions["transport"] =
      server.type === "stdio"
        ? {
            type: "stdio",
            command: server.command,
            args: [...server.args],
            env: { ...server.env },
            cwd,
            stderr: "inherit",
          }
        : {
            type: "streamableHttp",
            url: server.url,
            headers: server.headers,
            trustedAddresses: options.trustedHttpEndpoints?.find(
              (endpoint) => endpoint.url === server.url,
            )?.addresses,
            terminateSessionOnClose: true,
          };
    clients.push(
      new McpClient({
        name: server.name,
        versionNegotiation: { mode: "auto" },
        transport,
        tools: {
          prefix: `mcp_${createHash("sha256").update(server.name).digest("hex").slice(0, 16)}_`,
          discoveryLimits: { maxTools: 256, maxBytes: 1024 * 1024 },
        },
      }),
    );
  }
  signal.throwIfAborted();
  const group = await McpClientGroup.connect({ clients, abortSignal: signal });
  return {
    group,
    servers: Object.freeze(
      group.servers.map((server) =>
        Object.freeze({
          ...server,
          tools: Object.freeze(
            server.tools.map((tool) => Object.freeze({ ...tool, requiresApproval: true })),
          ),
        }),
      ),
    ),
  };
}

/** Frozen MCP tools retain identity through core's public registration snapshot. */
export function assertMcpRegistration(agent: Agent, servers: readonly McpServer[]): void {
  for (const server of servers) {
    const registered = agent.mcpServers.find((entry) => entry.name === server.name);
    if (!registered || server.tools.some((tool) => !registered.tools.includes(tool))) {
      throw new AcpError("configuration_error");
    }
  }
}

function entries(
  values: readonly { name: string; value: string }[],
  headers: boolean,
): Readonly<Record<string, string>> {
  const result: Record<string, string> = Object.create(null);
  const names = new Set<string>();
  for (const { name, value } of values) {
    const key = headers || process.platform === "win32" ? name.toLowerCase() : name;
    if (
      names.has(key) ||
      (headers
        ? !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name) ||
          /\p{Cc}/u.test(value) ||
          /^(accept|content-type|last-event-id|mcp-method|mcp-name|mcp-protocol-version|mcp-session-id|host|connection|content-length|transfer-encoding)$/i.test(
            name,
          ) ||
          name.toLowerCase().startsWith("mcp-param-")
        : !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) || value.includes("\0"))
    ) {
      throw new AcpError("invalid_mcp");
    }
    names.add(key);
    result[headers ? key : name] = value;
  }
  if (headers) {
    try {
      new Headers(result);
    } catch {
      throw new AcpError("invalid_mcp");
    }
  }
  return Object.freeze(result);
}

function httpUrl(value: string): string {
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.hash)
      throw new Error();
    return url.href;
  } catch {
    throw new AcpError("invalid_mcp");
  }
}
