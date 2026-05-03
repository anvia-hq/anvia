import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { AgentBuilder } from "@anvia/core/agent";
import type { Message } from "@anvia/core/completion";
import { createTool } from "@anvia/core/tool";
import { OpenAIClient } from "@anvia/openai";
import { z } from "zod";

type SavedHistoryRecord = {
  timestamp: string;
  messages: Message[];
};

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
  input: z.object({
    id: z.string().describe("The support ticket id."),
  }),
  output: z.object({
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

const historyPath = new URL("../.memory/tool-call-chat-history.json", import.meta.url);
const prompt = "Use the ticket tool to summarize TICKET-1001 and remember who owns it.";

const client = new OpenAIClient({
  baseUrl: "https://openrouter.ai/api/v1",
  apiKey: process.env.OPENROUTER_API_KEY,
});
const agentModel = client.completionModel("deepseek/deepseek-v4-pro");
const agent = new AgentBuilder("agent", agentModel)
  .instructions("Use tools for private ticket data. Use prior chat history when it is relevant.")
  .tools([getTicketTool])
  .defaultMaxTurns(2)
  .build();

const history = await buildHistory();
let finalMessages: Message[] | undefined;
let isThinking = false;

// This combines persisted history with tool calls in one streaming request.
for await (const event of agent.prompt(prompt).withHistory(history).stream()) {
  if (event.type !== "reasoning_delta" && isThinking) {
    process.stdout.write("</think>\n");
    isThinking = false;
  }

  if (event.type === "reasoning_delta") {
    if (!isThinking) {
      process.stdout.write("<think>");
      isThinking = true;
    }
    process.stdout.write(event.delta);
  }

  if (event.type === "tool_call") {
    console.log("tool call:", event.toolCall.function.name, event.toolCall.function.arguments);
  }

  if (event.type === "tool_result") {
    console.log("tool result:", event.result);
  }

  if (event.type === "text_delta") {
    process.stdout.write(event.delta);
  }

  if (event.type === "final") {
    finalMessages = event.messages;
  }
}

if (isThinking) {
  process.stdout.write("</think>\n");
}

process.stdout.write("\n");

if (finalMessages !== undefined) {
  await saveHistory(finalMessages);
  console.log("history file:", historyPath.pathname);
}

async function buildHistory(): Promise<Message[]> {
  const records = await readRecords();
  return records.slice(-5).flatMap((record) => record.messages);
}

async function saveHistory(messages: Message[]): Promise<void> {
  const records = await readRecords();
  records.push({
    timestamp: new Date().toISOString(),
    messages,
  });
  await mkdir(dirname(historyPath.pathname), { recursive: true });
  await writeFile(historyPath, `${JSON.stringify(records, null, 2)}\n`);
}

async function readRecords(): Promise<SavedHistoryRecord[]> {
  try {
    return JSON.parse(await readFile(historyPath, "utf8")) as SavedHistoryRecord[];
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
