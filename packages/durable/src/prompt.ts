import { z } from "zod";
import type { AgentPrompt } from "@anvia/core/agent";
import { messageSchema, type UserMessage } from "@anvia/core/completion";
import { json } from "./json.js";

const userMessage = messageSchema.transform((message, context) => {
  if (message.role === "user") return message;
  context.addIssue({ code: "custom", message: "A durable prompt must be a user message." });
  return z.NEVER;
});

// Use the core message contract, including image/file validation and JSON metadata.
export const promptSchema: z.ZodType<AgentPrompt> = z
  .union([z.string(), userMessage])
  .refine((prompt) => {
    const content = typeof prompt === "string" ? prompt : prompt.content;
    return typeof content === "string"
      ? content.trim().length > 0
      : content.some((part) => part.type !== "text" || part.text.trim().length > 0);
  }, "A durable prompt must contain text or media.");

export function parsePrompt(value: unknown): AgentPrompt {
  const parsed = promptSchema.safeParse(json(value));
  if (!parsed.success) throw new TypeError("Invalid durable prompt.");
  return parsed.data;
}

export function promptMessage(prompt: AgentPrompt): UserMessage {
  return typeof prompt === "string" ? { role: "user", content: prompt } : prompt;
}
