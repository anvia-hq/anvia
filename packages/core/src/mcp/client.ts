import { readFileSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { JsonObject } from "../completion/index";
import { abortError, throwIfAborted } from "../internal/abort";
import { linkAbortSignal } from "./abort";
import { createMcpTool } from "./tool";
import type { McpClientOptions, McpConnectOptions, McpServer, McpServerInfo } from "./types";
import { createSafeMcpFetch, parseAndValidateMcpUrl, parseMcpHttpUrl } from "./url-safety";

let coreClientVersion: string | undefined;

type ClientResource = {
  readonly client: Client;
  closePromise?: Promise<void> | undefined;
};

export class McpClient {
  readonly name: string;

  readonly #options: McpClientOptions;
  #closed = false;
  #connectAbortController?: AbortController | undefined;
  #connecting?: Promise<McpServer> | undefined;
  #resource?: ClientResource | undefined;
  #server?: McpServer | undefined;

  constructor(options: McpClientOptions) {
    if (options.name.trim() === "") {
      throw new TypeError("MCP client name must not be empty");
    }
    this.name = options.name;
    this.#options = options;
  }

  connect(options: McpConnectOptions = {}): Promise<McpServer> {
    if (this.#closed) {
      return Promise.reject(new Error(`MCP client "${this.name}" is closed`));
    }
    if (this.#server !== undefined) {
      return Promise.resolve(this.#server);
    }
    if (this.#connecting !== undefined) {
      return this.#connecting;
    }

    if (options.abortSignal?.aborted === true) {
      return Promise.reject(abortError(options.abortSignal.reason));
    }

    const abortController = new AbortController();
    const unlinkAbortSignal = linkAbortSignal(options.abortSignal, abortController);
    this.#connectAbortController = abortController;
    const connecting = this.#initialize(abortController.signal);
    this.#connecting = connecting;
    const clearConnecting = () => {
      unlinkAbortSignal();
      if (this.#connecting === connecting) {
        this.#connecting = undefined;
      }
      if (this.#connectAbortController === abortController) {
        this.#connectAbortController = undefined;
      }
    };
    void connecting.then(clearConnecting, clearConnecting);
    return connecting;
  }

  async close(): Promise<void> {
    this.#closed = true;
    this.#connectAbortController?.abort(
      abortError(new Error(`MCP client "${this.name}" was closed during connection`)),
    );

    const resource = this.#resource;
    if (resource !== undefined) {
      await closeResource(resource);
    }
  }

  async #initialize(abortSignal: AbortSignal): Promise<McpServer> {
    const client = createSdkClient();
    const resource: ClientResource = { client };
    this.#resource = resource;

    try {
      throwIfAborted(abortSignal);
      const transport = await createTransport(this.#options, { abortSignal });
      throwIfAborted(abortSignal);
      await client.connect(transport, requestOptions(abortSignal));
      throwIfAborted(abortSignal);
      const definitions = await listAllTools(client, abortSignal);
      throwIfAborted(abortSignal);
      const tools = definitions.map((definition) =>
        createMcpTool({
          definition,
          client,
          serverName: this.name,
          prefix: this.#options.tools?.prefix,
        }),
      );
      assertUniqueToolNames(tools, this.name);

      if (this.#closed) {
        throw new Error(`MCP client "${this.name}" was closed during connection`);
      }

      const serverInfo = copyServerInfo(client.getServerVersion());
      const capabilities = copyJsonObject(client.getServerCapabilities());
      const instructions = client.getInstructions();
      let registration: McpServer = {
        name: this.name,
        tools,
      };
      if (serverInfo !== undefined) registration = { ...registration, serverInfo };
      if (capabilities !== undefined) registration = { ...registration, capabilities };
      if (instructions !== undefined) registration = { ...registration, instructions };
      const server = freezeServer(registration);
      this.#server = server;
      return server;
    } catch (error) {
      try {
        await closeResource(resource);
      } catch {
        // Preserve the actionable connection or discovery failure.
      }
      if (this.#resource === resource) {
        this.#resource = undefined;
      }
      this.#server = undefined;
      throw error;
    }
  }
}

async function createTransport(
  options: McpClientOptions,
  connectOptions: McpConnectOptions,
): Promise<Transport> {
  const transport = options.transport;
  if (transport.type === "custom") {
    return transport.create({ abortSignal: connectOptions.abortSignal });
  }
  if (transport.type === "stdio") {
    let parameters: ConstructorParameters<typeof StdioClientTransport>[0] = {
      command: transport.command,
    };
    if (transport.args !== undefined) parameters = { ...parameters, args: transport.args };
    if (transport.env !== undefined) parameters = { ...parameters, env: transport.env };
    if (transport.cwd !== undefined) parameters = { ...parameters, cwd: transport.cwd };
    if (transport.stderr !== undefined) parameters = { ...parameters, stderr: transport.stderr };
    if (transport.maxBufferSize !== undefined) {
      parameters = { ...parameters, maxBufferSize: transport.maxBufferSize };
    }
    return new StdioClientTransport(parameters);
  }

  const ssrfProtection = transport.ssrfProtection ?? "strict";
  if (ssrfProtection !== "strict" && ssrfProtection !== "disabled") {
    throw new TypeError("MCP Streamable HTTP ssrfProtection must be strict or disabled");
  }
  let parameters: ConstructorParameters<typeof StreamableHTTPClientTransport>[1] = {};
  let url: URL;
  if (ssrfProtection === "strict") {
    parameters = { fetch: createSafeMcpFetch() };
    url = parseAndValidateMcpUrl(transport.url);
  } else {
    url = parseMcpHttpUrl(transport.url);
  }
  if (transport.requestInit !== undefined) {
    parameters = { ...parameters, requestInit: transport.requestInit };
  }
  if (transport.authProvider !== undefined) {
    parameters = { ...parameters, authProvider: transport.authProvider };
  }
  if (transport.reconnectionOptions !== undefined) {
    parameters = { ...parameters, reconnectionOptions: transport.reconnectionOptions };
  }
  if (transport.sessionId !== undefined) {
    parameters = { ...parameters, sessionId: transport.sessionId };
  }
  return asSdkTransport(new StreamableHTTPClientTransport(url, parameters));
}

async function listAllTools(
  client: Client,
  abortSignal?: AbortSignal | undefined,
): Promise<Awaited<ReturnType<Client["listTools"]>>["tools"]> {
  const tools: Awaited<ReturnType<Client["listTools"]>>["tools"] = [];
  const seenCursors = new Set<string>();
  let cursor: string | undefined;

  do {
    const page = await client.listTools(
      cursor === undefined ? undefined : { cursor },
      requestOptions(abortSignal),
    );
    tools.push(...page.tools);
    cursor = page.nextCursor;
    if (cursor !== undefined && seenCursors.has(cursor)) {
      throw new Error(`MCP server returned a repeated tools cursor: ${cursor}`);
    }
    if (cursor !== undefined) {
      seenCursors.add(cursor);
    }
  } while (cursor !== undefined);

  return tools;
}

function assertUniqueToolNames(tools: readonly { name: string }[], serverName: string): void {
  const names = new Set<string>();
  for (const tool of tools) {
    if (names.has(tool.name)) {
      throw new Error(`Duplicate MCP tool name "${tool.name}" from server "${serverName}"`);
    }
    names.add(tool.name);
  }
}

function createSdkClient(): Client {
  return new Client({
    name: "@anvia/core",
    version: getCoreClientVersion(),
  });
}

function getCoreClientVersion(): string {
  if (coreClientVersion === undefined) {
    coreClientVersion = readCorePackageVersion();
  }
  return coreClientVersion;
}

function requestOptions(signal?: AbortSignal | undefined): { signal?: AbortSignal } {
  return signal === undefined ? {} : { signal };
}

function asSdkTransport(transport: unknown): Transport {
  return transport as Transport;
}

function closeResource(resource: ClientResource): Promise<void> {
  resource.closePromise ??= resource.client.close();
  return resource.closePromise;
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

function copyServerInfo(value: ReturnType<Client["getServerVersion"]>): McpServerInfo | undefined {
  if (value === undefined) {
    return undefined;
  }
  return deepFreeze(structuredClone(value)) as McpServerInfo;
}

function copyJsonObject(value: unknown): JsonObject | undefined {
  if (value === undefined) {
    return undefined;
  }
  return deepFreeze(structuredClone(value)) as JsonObject;
}

function freezeServer(server: McpServer): McpServer {
  Object.freeze(server.tools);
  return Object.freeze(server);
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) {
    return value;
  }
  for (const child of Object.values(value)) {
    deepFreeze(child);
  }
  return Object.freeze(value);
}
