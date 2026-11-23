import {
  Client,
  type ListToolsResult,
  type Request,
  type RequestMethod,
  type RequestOptions,
  type ResultTypeMap,
  type StandardSchemaV1,
} from "@modelcontextprotocol/client";
import type { McpClientOptions } from "./types";

type DiscoveryLimits = NonNullable<McpClientOptions["tools"]>["discoveryLimits"];

/** One SDK client owns one immutable discovery snapshot. */
export class DiscoveryClient extends Client {
  readonly #limits: DiscoveryLimits;
  #discovering = false;
  #toolCount = 0;
  #toolBytes = 0;

  constructor(
    implementation: ConstructorParameters<typeof Client>[0],
    options: ConstructorParameters<typeof Client>[1],
    limits: DiscoveryLimits,
  ) {
    super(implementation, options);

    if (
      limits !== undefined &&
      (!Number.isSafeInteger(limits.maxTools) ||
        limits.maxTools <= 0 ||
        !Number.isSafeInteger(limits.maxBytes) ||
        limits.maxBytes <= 0)
    )
      throw new TypeError("MCP discovery limits must be positive integers");

    this.#limits = limits === undefined ? undefined : { ...limits };
  }

  async discoverTools(options: RequestOptions): Promise<ListToolsResult> {
    this.#discovering = true;
    try {
      return await this.listTools(undefined, options);
    } finally {
      this.#discovering = false;
    }
  }

  override request<M extends RequestMethod>(
    request: { method: M; params?: Record<string, unknown> },
    options?: RequestOptions,
  ): Promise<ResultTypeMap[M]>;
  override request<T extends StandardSchemaV1>(
    request: Request,
    schema: T,
    options?: RequestOptions,
  ): Promise<StandardSchemaV1.InferOutput<T>>;
  override async request(
    request: Request,
    schemaOrOptions?: StandardSchemaV1 | RequestOptions,
    options?: RequestOptions,
  ): Promise<unknown> {
    const result =
      schemaOrOptions !== undefined && "~standard" in schemaOrOptions
        ? await super.request(request, schemaOrOptions, options)
        : await super.request(
            request as { method: RequestMethod; params?: Record<string, unknown> },
            schemaOrOptions,
          );

    if (this.#discovering && request.method === "tools/list" && this.#limits !== undefined) {
      const tools = (result as ListToolsResult).tools;
      this.#toolCount += tools.length;

      if (this.#toolCount > this.#limits.maxTools) throw new Error("MCP tool count limit exceeded");

      this.#toolBytes += Buffer.byteLength(JSON.stringify(tools), "utf8");

      if (this.#toolBytes > this.#limits.maxBytes)
        throw new Error("MCP tool catalog byte limit exceeded");
    }

    return result;
  }
}
