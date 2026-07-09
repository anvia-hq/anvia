import type { JsonObject, JsonValue, Message } from "@anvia/core";
import { sql } from "drizzle-orm";
import { integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

export const agentMemorySessions = pgTable(
  "agent_memory_sessions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    scopeKey: text("scope_key").notNull(),
    sessionId: text("session_id").notNull(),
    userId: text("user_id"),
    metadata: jsonb("metadata").$type<JsonObject>().notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("agent_memory_sessions_scope_key_key").on(table.scopeKey)],
);

export const agentMemoryMessages = pgTable(
  "agent_memory_messages",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    memorySessionId: uuid("memory_session_id")
      .notNull()
      .references(() => agentMemorySessions.id, { onDelete: "cascade" }),
    runId: text("run_id").notNull(),
    turn: integer("turn").notNull(),
    position: integer("position").notNull(),
    role: text("role").$type<Message["role"]>().notNull(),
    message: jsonb("message").$type<Message>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("agent_memory_messages_session_position_key").on(
      table.memorySessionId,
      table.position,
    ),
  ],
);

export const agentMemoryErrors = pgTable("agent_memory_errors", {
  id: uuid("id").defaultRandom().primaryKey(),
  memorySessionId: uuid("memory_session_id")
    .notNull()
    .references(() => agentMemorySessions.id, { onDelete: "cascade" }),
  runId: text("run_id").notNull(),
  error: jsonb("error").$type<JsonValue>().notNull(),
  messages: jsonb("messages").$type<Message[]>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const drizzleMemorySchema = {
  agentMemorySessions,
  agentMemoryMessages,
  agentMemoryErrors,
} as const;
