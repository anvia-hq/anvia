import { Agent } from "@anvia/core/agent";
import type { Message } from "@anvia/core/completion";
import type { MemoryAppendInput, MemoryContext, MemoryStore } from "@anvia/core/memory";
import { OpenAIClient } from "@anvia/openai";

class LocalMemoryStore implements MemoryStore {
  private readonly sessions = new Map<string, Message[]>();

  async load(context: MemoryContext): Promise<Message[]> {
    return [...(this.sessions.get(context.sessionId) ?? [])];
  }

  async append(input: MemoryAppendInput): Promise<void> {
    const current = this.sessions.get(input.context.sessionId) ?? [];
    this.sessions.set(input.context.sessionId, [...current, ...input.messages]);
  }

  async clear(context: MemoryContext): Promise<void> {
    this.sessions.delete(context.sessionId);
  }
}

const client = new OpenAIClient({
  baseUrl: process.env.OPENAI_BASEURL,
  apiKey: process.env.OPENAI_API_KEY,
});
const agentModel = client.completionModel("gpt-5.5");
const memory = new LocalMemoryStore();

const agent = new Agent({
  id: "agent",
  model: agentModel,
  instructions: "You are a concise assistant that remembers durable session context.",
  memory: { store: memory },
});

const session = agent.session("demo-session", { userId: "cookbook-user" });

await session.prompt("Remember that my project is named Anvia.").send();
const response = await session.prompt("What is my project named?").send();

console.log(response.output);
