import { Agent } from "@anvia/core/agent";
import type { Message } from "@anvia/core/completion";
import type { MemoryAppendOptions, MemoryScope, MemoryStore } from "@anvia/core/memory";
import { OpenAIClient } from "@anvia/openai";

class LocalMemoryStore implements MemoryStore {
  private readonly sessions = new Map<string, Message[]>();

  async load({ scope }: { scope: MemoryScope }): Promise<Message[]> {
    return [...(this.sessions.get(scope.sessionId) ?? [])];
  }

  async append(input: MemoryAppendOptions): Promise<void> {
    const current = this.sessions.get(input.scope.sessionId) ?? [];
    this.sessions.set(input.scope.sessionId, [...current, ...input.messages]);
  }

  async clear({ scope }: { scope: MemoryScope }): Promise<void> {
    this.sessions.delete(scope.sessionId);
  }
}

const client = new OpenAIClient({
  baseUrl: process.env.OPENAI_BASEURL,
  apiKey: process.env.OPENAI_API_KEY ?? "",
});
const agentModel = client.completionModel({ modelId: "gpt-5.5", api: "responses" });
const memory = new LocalMemoryStore();

const agent = new Agent({
  id: "agent",
  model: agentModel,
  instructions: "You are a concise assistant that remembers durable session context.",
  memory: { store: memory },
});

const session = { sessionId: "demo-session", userId: "cookbook-user" };

await agent.generate({ prompt: "Remember that my project is named Anvia.", session });
const response = await agent.generate({ prompt: "What is my project named?", session });

if (response.type !== "response") throw new Error("Unexpected tool approval request.");
console.log(response.output);
