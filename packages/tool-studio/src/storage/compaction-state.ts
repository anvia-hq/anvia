import { parseMessage, type Message } from "@anvia/core/completion";
import { isMemoryCompactionMessage, type MemoryCompactionMessage } from "@anvia/core/memory";

export type StoredStudioCompactionState = {
  version: 1;
  generation: number;
  summary: MemoryCompactionMessage;
  summarizedThroughPosition: number;
};

export type StudioCompactionMessageRow = {
  position: number;
  message: Message;
};

export function parseStudioCompactionState(
  value: string | null,
): StoredStudioCompactionState | undefined {
  if (value === null) return undefined;
  const parsed: unknown = JSON.parse(value);
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("Stored Studio memory compaction state is invalid.");
  }
  const record = parsed as Record<string, unknown>;
  let summary: Message;
  try {
    summary = parseMessage(record.summary);
  } catch (cause) {
    throw new Error("Stored Studio memory compaction state summary is invalid.", { cause });
  }
  if (
    record.version !== 1 ||
    !Number.isSafeInteger(record.generation) ||
    (record.generation as number) < 1 ||
    !isMemoryCompactionMessage(summary) ||
    !Number.isSafeInteger(record.summarizedThroughPosition) ||
    (record.summarizedThroughPosition as number) < 0
  ) {
    throw new Error("Stored Studio memory compaction state is invalid.");
  }
  return {
    version: 1,
    generation: record.generation as number,
    summary,
    summarizedThroughPosition: record.summarizedThroughPosition as number,
  };
}

export function projectStudioCompactionMessages(
  rows: StudioCompactionMessageRow[],
  state: StoredStudioCompactionState | undefined,
): Message[] {
  if (state === undefined) return rows.map((row) => row.message);
  return [state.summary, ...activeStudioCompactionMessages(rows, state).map((row) => row.message)];
}

export function activeStudioCompactionMessages(
  rows: StudioCompactionMessageRow[],
  state: StoredStudioCompactionState | undefined,
): StudioCompactionMessageRow[] {
  if (state === undefined) return rows;
  const boundaryIndex = rows.findIndex((row) => row.position === state.summarizedThroughPosition);
  if (boundaryIndex === -1) {
    throw new Error("Stored Studio memory compaction state boundary is invalid.");
  }
  return rows.slice(boundaryIndex + 1);
}

export function studioCompactionRevision(
  rows: StudioCompactionMessageRow[],
  state: StoredStudioCompactionState | undefined,
): string {
  return JSON.stringify([state?.generation ?? 0, rows]);
}
