/** Prisma models for the tables the durable store uses. Names are mapped to the SQL tables. */
export const prismaDurableModelNames = [
  "AnviaDurableOwner",
  "AnviaDurableBlob",
  "AnviaDurableRun",
  "AnviaDurableRunSummary",
  "AnviaDurableGraph",
  "AnviaDurableOperation",
  "AnviaDurableEvent",
  "AnviaDurableTask",
  "AnviaDurableMessage",
  "AnviaDurableHistory",
] as const;

export const prismaDurableSchema = `model AnviaDurableOwner {
  singleton      Int       @id
  version        Int
  token          String?
  leaseExpiresAt DateTime? @map("lease_expires_at") @db.Timestamptz(6)
  host           String?
  pid            Int?

  @@map("anvia_durable_owner")
}

model AnviaDurableBlob {
  hash   String @id
  bytes  BigInt
  record String

  @@map("anvia_durable_blobs")
}

model AnviaDurableRun {
  seq           BigInt  @unique @default(autoincrement())
  id            String  @id
  sessionId     String  @map("session_id")
  requestId     String  @map("request_id")
  status        String
  agentId       String  @map("agent_id")
  graphId       String? @map("graph_id")
  createdAt     String  @map("created_at")
  startedAt     String? @map("started_at")
  nextAttemptAt String? @map("next_attempt_at")
  outcomeType   String? @map("outcome_type")
  dependencies  Json?   @db.JsonB
  record        String

  @@unique([sessionId, requestId], map: "anvia_durable_runs_session_id_request_id_key")
  @@index([sessionId, status], map: "anvia_durable_run_session")
  @@index([agentId, status], map: "anvia_durable_run_agent_status")
  @@index([graphId], map: "anvia_durable_run_graph")
  @@map("anvia_durable_runs")
}

model AnviaDurableRunSummary {
  id     String @id
  record String

  @@map("anvia_durable_run_summaries")
}

model AnviaDurableGraph {
  seq       BigInt @unique @default(autoincrement())
  id        String @id
  sessionId String @map("session_id")
  requestId String @map("request_id")
  createdAt String @map("created_at")
  record    String

  @@unique([sessionId, requestId], map: "anvia_durable_graphs_session_id_request_id_key")
  @@map("anvia_durable_graphs")
}

model AnviaDurableOperation {
  seq    BigInt @unique @default(autoincrement())
  runId  String @map("run_id")
  key    String
  record String

  @@id([runId, key])
  @@map("anvia_durable_operations")
}

model AnviaDurableEvent {
  sequence        BigInt  @id @default(autoincrement())
  runId           String  @map("run_id")
  createdAt       String  @map("created_at")
  type            String
  data            String
  historyEncoding String? @map("history_encoding")

  @@index([runId, sequence], map: "anvia_durable_event_run")
  @@map("anvia_durable_events")
}

model AnviaDurableTask {
  seq        BigInt @unique @default(autoincrement())
  id         String @id
  rootId     String @map("root_id")
  parentId   String @map("parent_id")
  sessionId  String @map("session_id")
  key        String
  status     String
  readyOrder BigInt @map("ready_order")
  createdAt  String @map("created_at")
  record     String

  @@unique([sessionId, parentId, key], map: "anvia_durable_tasks_session_id_parent_id_key_key")
  @@index([rootId], map: "anvia_durable_task_root")
  @@index([parentId], map: "anvia_durable_task_parent")
  @@index([status], map: "anvia_durable_task_status")
  @@map("anvia_durable_tasks")
}

model AnviaDurableMessage {
  hash   String @id
  record String

  @@map("anvia_durable_messages")
}

model AnviaDurableHistory {
  hash     String  @id
  previous String?
  message  String

  @@map("anvia_durable_histories")
}
`;
