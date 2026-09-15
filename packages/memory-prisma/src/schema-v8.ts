import { generatedSchemaHeader } from "./schema.js";

// Preserve Prisma 7's text IDs, jsonb, and timestamp(3) columns. TimestampString
// avoids imposing a Temporal implementation on the caller. Values represent UTC.
export const prisma8MemorySchema = `model AgentMemorySession {
  id              String @id @default(cuid(2))
  scopeKey        String @unique
  sessionId       String
  userId          String?
  metadata        Jsonb
  compactionState Jsonb?
  createdAt       TimestampString(3) @default(now())
  updatedAt       TimestampString(3)

  messages AgentMemoryMessage[]
  errors   AgentMemoryError[]

  @@index([sessionId, userId])
  @@map("AgentMemorySession")
}

model AgentMemoryMessage {
  id              String @id @default(cuid(2))
  memorySessionId String
  memorySession   AgentMemorySession @relation(fields: [memorySessionId], references: [id], onDelete: Cascade, onUpdate: Cascade)
  runId           String
  turn            Int
  position        Int
  role            String
  message         Jsonb
  createdAt       TimestampString(3) @default(now())

  @@unique([memorySessionId, position])
  @@index([runId])
  @@map("AgentMemoryMessage")
}

model AgentMemoryError {
  id              String @id @default(cuid(2))
  memorySessionId String
  memorySession   AgentMemorySession @relation(fields: [memorySessionId], references: [id], onDelete: Cascade, onUpdate: Cascade)
  runId           String
  error           Jsonb
  messages        Jsonb
  createdAt       TimestampString(3) @default(now())

  @@index([runId])
  @@map("AgentMemoryError")
}
`;

export const prisma8StartMarker = "// BEGIN ANVIA MEMORY PRISMA 8 MODELS";
export const prisma8EndMarker = "// END ANVIA MEMORY PRISMA 8 MODELS";

export function prisma8SchemaBlock(): string {
  return `${prisma8StartMarker}\n${generatedSchemaHeader}\n\n${prisma8MemorySchema}${prisma8EndMarker}\n`;
}
