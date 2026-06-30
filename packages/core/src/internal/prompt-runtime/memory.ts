import type { Agent } from "../../agent/agent";
import type { Message as MessageType } from "../../completion/index";
import type { MemoryContext, MemoryRegistration, MemorySavePolicy } from "../../memory/types";

export class PromptRequestMemory {
  constructor(
    private readonly agent: Agent,
    private readonly memoryContext: MemoryContext | undefined,
    private readonly initialHistory: MessageType[],
  ) {}

  memoryPolicy(): MemorySavePolicy | undefined {
    return this.memory()?.options.savePolicy;
  }

  pendingTurnMessages(newMessages: MessageType[]): MessageType[] {
    return this.memoryPolicy() === "turn" ? [...newMessages] : [];
  }

  async prepareRun(runId: string, newMessages: MessageType[]): Promise<MessageType[]> {
    const memory = this.memory();
    if (memory === undefined || this.memoryContext === undefined) {
      return this.initialHistory;
    }

    const memoryHistory = await memory.store.load(this.memoryContext);
    const chatHistory = [...memoryHistory, ...this.initialHistory];
    if (memory.options.savePolicy === "message") {
      await memory.store.append({
        context: this.memoryContext,
        runId,
        turn: 1,
        messages: newMessages,
      });
    }
    return chatHistory;
  }

  async commitMessages(
    runId: string,
    turn: number,
    messages: MessageType[],
    pendingTurnMessages: MessageType[],
  ): Promise<void> {
    const memory = this.memory();
    if (memory === undefined || this.memoryContext === undefined || messages.length === 0) {
      return;
    }
    if (memory.options.savePolicy === "message") {
      await memory.store.append({
        context: this.memoryContext,
        runId,
        turn,
        messages,
      });
    } else if (memory.options.savePolicy === "turn") {
      pendingTurnMessages.push(...messages);
    }
  }

  async commitCompletedTurn(
    runId: string,
    turn: number,
    pendingTurnMessages: MessageType[],
  ): Promise<void> {
    const memory = this.memory();
    if (
      memory === undefined ||
      this.memoryContext === undefined ||
      memory.options.savePolicy !== "turn" ||
      pendingTurnMessages.length === 0
    ) {
      return;
    }
    await memory.store.append({
      context: this.memoryContext,
      runId,
      turn,
      messages: [...pendingTurnMessages],
    });
    pendingTurnMessages.length = 0;
  }

  async commitCompletedRun(
    runId: string,
    turn: number,
    newMessages: MessageType[],
    pendingTurnMessages: MessageType[],
  ): Promise<void> {
    await this.commitCompletedTurn(runId, turn, pendingTurnMessages);
    const memory = this.memory();
    if (
      memory === undefined ||
      this.memoryContext === undefined ||
      memory.options.savePolicy !== "run"
    ) {
      return;
    }
    await memory.store.append({
      context: this.memoryContext,
      runId,
      turn,
      messages: [...newMessages],
    });
  }

  async recordError(runId: string, error: unknown, newMessages: MessageType[]): Promise<void> {
    const memory = this.memory();
    if (memory === undefined || this.memoryContext === undefined) {
      return;
    }
    await memory.store.recordError?.({
      context: this.memoryContext,
      runId,
      error,
      messages: [...newMessages],
    });
  }

  private memory(): MemoryRegistration | undefined {
    return this.memoryContext === undefined ? undefined : this.agent.memory;
  }
}
