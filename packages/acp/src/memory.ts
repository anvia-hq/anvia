import type { Message } from "@anvia/core/completion";
import type { MemoryAppendOptions, MemoryLoadOptions, MemoryStore } from "@anvia/core/memory";
import { AcpError } from "./errors.js";
import type { AcpLimits } from "./types.js";

/** One private scope, atomic completed-turn appends, no eviction of tool-call pairs. */
export class SessionMemory implements MemoryStore {
  private messages: Message[] = [];

  constructor(
    private readonly sessionId: string,
    private readonly limits: AcpLimits,
    messages: readonly Message[] = [],
  ) {
    this.assertFits(messages);
    this.messages = structuredClone([...messages]);
  }

  async load({ scope }: MemoryLoadOptions): Promise<Message[]> {
    this.assertScope(scope.sessionId);
    return structuredClone(this.messages);
  }

  assertFits(messages: readonly Message[]): void {
    if (
      messages.length > this.limits.maxHistoryMessages ||
      Buffer.byteLength(JSON.stringify(messages), "utf8") > this.limits.maxHistoryBytes
    ) {
      throw new AcpError("resource_limit");
    }
  }

  async append({ scope, messages }: MemoryAppendOptions): Promise<void> {
    this.assertScope(scope.sessionId);
    const next = [...this.messages, ...messages];
    this.assertFits(next);
    this.messages = structuredClone(next);
  }

  async clear({ scope }: MemoryLoadOptions): Promise<void> {
    this.assertScope(scope.sessionId);
    this.messages = [];
  }

  private assertScope(sessionId: string): void {
    if (sessionId !== this.sessionId) throw new AcpError("session_not_found");
  }
}
