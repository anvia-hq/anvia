import { Agent } from "@anvia/core/agent";
import type { Message } from "@anvia/core/completion";
import type { MemoryAppendOptions, MemoryScope, MemoryStore } from "@anvia/core/memory";
import { createTool } from "@anvia/core/tool";
import { OpenAIClient } from "@anvia/openai";
import { z } from "zod";

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

const tickets = new Map([
  [
    "TICKET-1001",
    {
      id: "TICKET-1001",
      customer: "Acme Co.",
      owner: "Mira",
      priority: "high",
      status: "waiting_on_engineering",
      summary: "Webhook retries fail when payloads are larger than 512 KB.",
    },
  ],
]);

const getTicketTool = createTool({
  name: "get_ticket",
  description: "Read a support ticket from local application state.",
  inputSchema: z.object({
    id: z.string().describe("The support ticket id."),
  }),
  outputSchema: z.object({
    id: z.string(),
    customer: z.string(),
    owner: z.string(),
    priority: z.string(),
    status: z.string(),
    summary: z.string(),
  }),
  execute({ id }) {
    const ticket = tickets.get(id);
    if (ticket === undefined) {
      throw new Error(`Ticket not found: ${id}`);
    }
    return ticket;
  },
});

const client = new OpenAIClient({
  baseUrl: process.env.OPENAI_BASEURL,
  apiKey: process.env.OPENAI_API_KEY ?? "",
});
const agentModel = client.completionModel({ modelId: "gpt-5.5", api: "responses" });
const memory = new LocalMemoryStore();

const agent = new Agent({
  id: "agent",
  model: agentModel,
  instructions: "Use tools for private ticket data. Use durable session memory when relevant.",
  memory: { store: memory },
  maxTurns: 2,
  tools: [getTicketTool],
});

const session = { sessionId: "ticket-demo", userId: "cookbook-user" };
const prompt = "Use the ticket tool to summarize TICKET-1001 and remember who owns it.";

for await (const event of agent.stream({ prompt, session })) {
  if (event.type === "tool_call") {
    console.log("tool call:", event.toolCall.toolName, event.toolCall.input);
  }

  if (event.type === "tool_result") {
    console.log("tool result:", event.result);
  }

  if (event.type === "text_delta") {
    process.stdout.write(event.delta);
  }
}

process.stdout.write("\n");

const followUp = await agent.generate({
  prompt: "Who owns the ticket we just discussed?",
  session,
});
if (followUp.status !== "completed") throw new Error("Unexpected tool approval request.");
console.log(followUp.output);
