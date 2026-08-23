import { readFileSync } from "node:fs";
import type { JsonObject } from "@anvia/core/completion";
import type { Transport } from "@modelcontextprotocol/client";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { abortError, linkAbortSignal, throwIfAborted } from "./abort";
import { createMcpTool } from "./tool";
import type { McpClientOptions, McpConnectOptions, McpServer, McpServerInfo } from "./types";
import { createSafeMcpFetch, parseAndValidateMcpUrl, parseMcpHttpUrl } from "./url-safety";

let mcpClientVersion: string | undefined;
const modernMcpProtocolVersion = "2026-07-28";

type ClientResource = {
  readonly client: Client;
  closePromise?: Promise<void> | undefined;
};

type McpFetch = NonNullable<
  NonNullable<ConstructorParameters<typeof StreamableHTTPClientTransport>[1]>["fetch"]
>;

const transportOwnedHttpHeaders = new Set([
  "accept",
  "content-type",
  "last-event-id",
  "mcp-method",
  "mcp-name",
  "mcp-protocol-version",
  "mcp-session-id",
]);

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
  let transportFetch: McpFetch | undefined;
  if (ssrfProtection === "strict") {
    transportFetch = createSafeMcpFetch();
    url = parseAndValidateMcpUrl(transport.url);
  } else {
    url = parseMcpHttpUrl(transport.url);
  }
  if (transport.headers !== undefined) {
    const headers = copyMcpHeaders(transport.headers, transport.authProvider !== undefined);
    const fetchRequest = transportFetch ?? defaultMcpFetch;
    transportFetch = createMcpEndpointFetch(url, headers, fetchRequest);
  }
  if (transportFetch !== undefined) parameters = { ...parameters, fetch: transportFetch };
  if (transport.authProvider !== undefined) {
    parameters = { ...parameters, authProvider: transport.authProvider };
  }
  if (transport.reconnectionOptions !== undefined) {
    parameters = { ...parameters, reconnectionOptions: transport.reconnectionOptions };
  }
  if (transport.sessionId !== undefined) {
    parameters = { ...parameters, sessionId: transport.sessionId };
  }
  return new StreamableHTTPClientTransport(url, parameters);
}

function copyMcpHeaders(
  value: Readonly<Record<string, string>>,
  hasAuthProvider: boolean,
): Headers {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("MCP Streamable HTTP headers must be a plain object");
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError("MCP Streamable HTTP headers must be a plain object");
  }
  const headers = new Headers();
  for (const [name, headerValue] of Object.entries(value)) {
    if (typeof headerValue !== "string") {
      throw new TypeError(`MCP Streamable HTTP header ${name} must be a string`);
    }
    const normalizedName = name.toLowerCase();
    if (transportOwnedHttpHeaders.has(normalizedName) || normalizedName.startsWith("mcp-param-")) {
      throw new TypeError(`MCP Streamable HTTP header ${name} is owned by the transport`);
    }
    if (hasAuthProvider && normalizedName === "authorization") {
      throw new TypeError(
        "MCP Streamable HTTP authorization header cannot be combined with authProvider",
      );
    }
    headers.set(name, headerValue);
  }
  return headers;
}

function createMcpEndpointFetch(
  endpoint: URL,
  configuredHeaders: Headers,
  fetchRequest: McpFetch,
): McpFetch {
  return (input, init) => {
    const requestUrl = input instanceof Request ? new URL(input.url) : new URL(input);
    if (requestUrl.href !== endpoint.href) return fetchRequest(input, init);

    const requestHeaders = new Headers(
      init?.headers ?? (input instanceof Request ? input.headers : undefined),
    );
    configuredHeaders.forEach((value, name) => {
      requestHeaders.set(name, value);
    });
    return fetchRequest(input, { ...init, headers: requestHeaders, redirect: "error" });
  };
}

const defaultMcpFetch: McpFetch = (input, init) => globalThis.fetch(input, init);

async function listAllTools(
  client: Client,
  abortSignal?: AbortSignal | undefined,
): Promise<Awaited<ReturnType<Client["listTools"]>>["tools"]> {
  const result = await client.listTools(undefined, requestOptions(abortSignal));
  return result.tools;
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
  const implementation = {
    name: "@anvia/mcp",
    version: getMcpClientVersion(),
  };
  return new Client(implementation, {
    versionNegotiation: { mode: { pin: modernMcpProtocolVersion } },
  });
}

function getMcpClientVersion(): string {
  if (mcpClientVersion === undefined) {
    mcpClientVersion = readMcpPackageVersion();
  }
  return mcpClientVersion;
}

function requestOptions(signal?: AbortSignal | undefined): { signal?: AbortSignal } {
  return signal === undefined ? {} : { signal };
}

function closeResource(resource: ClientResource): Promise<void> {
  resource.closePromise ??= resource.client.close();
  return resource.closePromise;
}

function readMcpPackageVersion(): string {
  try {
    const packageJson = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8"),
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
