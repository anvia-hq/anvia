import { z } from "zod";
import { isJsonValue } from "./json";
import type { JsonObject, JsonValue, Message } from "./types";

const jsonValueSchema = z.custom<JsonValue>(isJsonValue, {
  message: "Expected a strict JSON value",
});

const jsonObjectSchema = z.custom<JsonObject>(
  (value) =>
    typeof value === "object" && value !== null && !Array.isArray(value) && isJsonValue(value),
  { message: "Expected a strict JSON object" },
);

const textPartSchema = z
  .object({
    type: z.literal("text"),
    text: z.string(),
    signature: z.string().optional(),
  })
  .strict();

const urlDataSchema = z.object({ type: z.literal("url"), url: z.url() }).strict();
const binaryDataSchema = z
  .object({
    type: z.literal("data"),
    data: z.string().refine(isBase64, { message: "Expected base64 data" }),
  })
  .strict();
const textDataSchema = z.object({ type: z.literal("text"), text: z.string() }).strict();
const fileDataSchema = z.union([urlDataSchema, binaryDataSchema, textDataSchema]);
const mediaTypeSchema = z.string().regex(/^[^\s/]+\/[^\s/]+(?:\s*;.*)?$/, "Expected a media type");

const imagePartSchema = z
  .object({
    type: z.literal("image"),
    image: z.union([urlDataSchema, binaryDataSchema]),
    mediaType: mediaTypeSchema.optional(),
    detail: z.enum(["auto", "low", "high"]).optional(),
  })
  .strict();

const filePartSchema = z
  .object({
    type: z.literal("file"),
    data: fileDataSchema,
    mediaType: mediaTypeSchema,
    filename: z.string().optional(),
  })
  .strict();

const reasoningDetailSchema = z.union([
  z
    .object({ type: z.literal("text"), text: z.string(), signature: z.string().optional() })
    .strict(),
  z.object({ type: z.literal("summary"), text: z.string() }).strict(),
  z.object({ type: z.literal("encrypted"), data: z.string() }).strict(),
  z.object({ type: z.literal("redacted"), data: z.string() }).strict(),
]);

const reasoningPartSchema = z
  .object({
    type: z.literal("reasoning"),
    text: z.string(),
    id: z.string().optional(),
    details: z.array(reasoningDetailSchema).optional(),
  })
  .strict();

const toolCallPartSchema = z
  .object({
    type: z.literal("tool-call"),
    toolCallId: z.string().min(1),
    callId: z.string().optional(),
    toolName: z.string().min(1),
    input: jsonValueSchema,
    signature: z.string().optional(),
  })
  .strict();

const toolResultOutputSchema = z.union([
  z.object({ type: z.literal("text"), value: z.string() }).strict(),
  z.object({ type: z.literal("json"), value: jsonValueSchema }).strict(),
  z
    .object({
      type: z.literal("content"),
      value: z.array(z.union([textPartSchema, filePartSchema])),
    })
    .strict(),
  z.object({ type: z.literal("execution-denied"), reason: z.string().optional() }).strict(),
  z.object({ type: z.literal("error-text"), value: z.string() }).strict(),
  z.object({ type: z.literal("error-json"), value: jsonValueSchema }).strict(),
]);

const toolResultPartSchema = z
  .object({
    type: z.literal("tool-result"),
    toolCallId: z.string().min(1),
    callId: z.string().optional(),
    toolName: z.string().min(1),
    output: toolResultOutputSchema,
  })
  .strict();

const toolApprovalResponsePartSchema = z
  .object({
    type: z.literal("tool-approval-response"),
    interactionId: z.string().min(1),
    toolCallId: z.string().min(1),
    callId: z.string().optional(),
    toolName: z.string().min(1),
    approved: z.boolean(),
    reason: z.string().optional(),
  })
  .strict();

const toolQuestionAnswerSchema = z
  .object({
    questionId: z.string().min(1),
    value: z.string(),
  })
  .strict();

const toolQuestionResponsePartSchema = z
  .object({
    type: z.literal("tool-question-response"),
    interactionId: z.string().min(1),
    toolCallId: z.string().min(1),
    callId: z.string().optional(),
    toolName: z.string().min(1),
    answers: z.array(toolQuestionAnswerSchema),
  })
  .strict();

export type MessageMetadataSchema<Metadata extends JsonObject> = z.ZodType<Metadata>;

export function createMessageSchema<Metadata extends JsonObject>(options: {
  metadataSchema: MessageMetadataSchema<Metadata>;
}): z.ZodType<Message<Metadata>> {
  const metadata = options.metadataSchema.optional();
  const system = z.object({ role: z.literal("system"), content: z.string(), metadata }).strict();
  const user = z
    .object({
      role: z.literal("user"),
      content: z.union([
        z.string(),
        z.array(z.union([textPartSchema, imagePartSchema, filePartSchema])),
      ]),
      metadata,
    })
    .strict();
  const assistant = z
    .object({
      role: z.literal("assistant"),
      id: z.string().optional(),
      content: z.union([
        z.string(),
        z.array(
          z.union([
            textPartSchema,
            imagePartSchema,
            filePartSchema,
            reasoningPartSchema,
            toolCallPartSchema,
          ]),
        ),
      ]),
      metadata,
    })
    .strict();
  const tool = z
    .object({
      role: z.literal("tool"),
      content: z.array(
        z.union([
          toolResultPartSchema,
          toolApprovalResponsePartSchema,
          toolQuestionResponsePartSchema,
        ]),
      ),
      metadata,
    })
    .strict();

  const message = z.union([system, user, assistant, tool]);
  return z
    .custom<z.input<typeof message>>(isJsonValue, { message: "Expected a strict JSON message" })
    .pipe(message)
    .refine(isJsonValue, { message: "Expected a strict JSON message" }) as unknown as z.ZodType<
    Message<Metadata>
  >;
}

export const messageSchema = createMessageSchema({ metadataSchema: jsonObjectSchema });
export const messagesSchema = z.array(messageSchema);

export function parseMessage(value: unknown): Message {
  return messageSchema.parse(value);
}

export function parseMessages(value: unknown): Message[] {
  return messagesSchema.parse(value);
}

export function isMessage(value: unknown): value is Message {
  return messageSchema.safeParse(value).success;
}

function isBase64(value: string): boolean {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(value)) return false;
  const firstPadding = value.indexOf("=");
  if (firstPadding !== -1 && firstPadding < value.length - 2) return false;
  const rawLength = value.replace(/=+$/, "").length;
  if (rawLength % 4 === 1) return false;
  return firstPadding === -1 || value.length % 4 === 0;
}
