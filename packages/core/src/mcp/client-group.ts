import { linkAbortSignal } from "./abort";
import type { McpClient } from "./client";
import type { McpClientGroupConnectOptions, McpServer } from "./types";

export class McpClientGroup {
  readonly clients: readonly McpClient[];
  readonly servers: readonly McpServer[];

  #closePromise?: Promise<void> | undefined;

  private constructor(clients: readonly McpClient[], servers: readonly McpServer[]) {
    this.clients = Object.freeze([...clients]);
    this.servers = Object.freeze([...servers]);
  }

  static async connect(options: McpClientGroupConnectOptions): Promise<McpClientGroup> {
    const clients = [...options.clients];
    assertUniqueClientNames(clients);

    const abortController = new AbortController();
    const unlinkAbortSignal = linkAbortSignal(options.abortSignal, abortController);
    let firstConnectionFailure: unknown;
    let connectionFailed = false;
    const connections = clients.map((client) =>
      client.connect({ abortSignal: abortController.signal }).catch((error: unknown) => {
        if (!connectionFailed) {
          connectionFailed = true;
          firstConnectionFailure = error;
          abortController.abort(error);
        }
        throw error;
      }),
    );
    const settled = await Promise.allSettled(connections).finally(unlinkAbortSignal);
    const firstFailure = settled.find(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    if (firstFailure !== undefined) {
      await rollbackSuccessfulClients(clients, settled);
      throw connectionFailed ? firstConnectionFailure : firstFailure.reason;
    }

    const servers = settled.map((result) => (result as PromiseFulfilledResult<McpServer>).value);
    try {
      assertUniqueServerAndToolNames(servers);
    } catch (error) {
      try {
        await closeAll(clients);
      } catch {
        // Preserve the registration validation failure that caused rollback.
      }
      throw error;
    }

    return new McpClientGroup(clients, servers);
  }

  close(): Promise<void> {
    this.#closePromise ??= closeAll(this.clients);
    return this.#closePromise;
  }
}

function assertUniqueClientNames(clients: readonly McpClient[]): void {
  const names = new Set<string>();
  for (const client of clients) {
    if (names.has(client.name)) {
      throw new Error(`Duplicate MCP client name "${client.name}"`);
    }
    names.add(client.name);
  }
}

function assertUniqueServerAndToolNames(servers: readonly McpServer[]): void {
  const serverNames = new Set<string>();
  const toolNames = new Map<string, string>();
  for (const server of servers) {
    if (serverNames.has(server.name)) {
      throw new Error(`Duplicate MCP server name "${server.name}"`);
    }
    serverNames.add(server.name);

    for (const tool of server.tools) {
      const existing = toolNames.get(tool.name);
      if (existing !== undefined) {
        throw new Error(
          `Duplicate MCP tool name "${tool.name}" from servers "${existing}" and "${server.name}"`,
        );
      }
      toolNames.set(tool.name, server.name);
    }
  }
}

async function rollbackSuccessfulClients(
  clients: readonly McpClient[],
  settled: readonly PromiseSettledResult<McpServer>[],
): Promise<void> {
  const successful = clients.filter((_, index) => settled[index]?.status === "fulfilled");
  try {
    await closeAll(successful);
  } catch {
    // Preserve the connection failure that caused rollback.
  }
}

async function closeAll(clients: readonly McpClient[]): Promise<void> {
  const settled = await Promise.allSettled(clients.map((client) => client.close()));
  const errors = settled.flatMap((result) => (result.status === "rejected" ? [result.reason] : []));
  if (errors.length > 0) {
    throw new AggregateError(errors, "Failed to close one or more MCP clients");
  }
}
