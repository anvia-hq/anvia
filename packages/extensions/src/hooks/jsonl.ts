import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import type { AgentLifecycle } from "@anvia/core/agent";
import type { Redactor } from "@anvia/core/redaction";
import { type AuditEvent, auditHook } from "./audit";

export type JsonlHookOptions =
  | {
      /** Destination `.jsonl` file path. Parent directories are created automatically. */
      filePath: string;
      write?: never;
      /** Include tool input payloads in audit lines. Default false (privacy-safe). */
      includeToolInput?: boolean | undefined;
      /** Include tool output payloads in audit lines. Default false (privacy-safe). */
      includeToolOutput?: boolean | undefined;
      /** Optional redactor applied to audit events before JSON serialization. */
      redactor?: Redactor | undefined;
      /** Custom timestamp provider for deterministic testing. */
      timestamp?: (() => string) | undefined;
    }
  | {
      filePath?: never;
      /** Custom line sink receiving each serialized JSONL line (including trailing `\n`) and the (redacted) event. */
      write: (line: string, event: AuditEvent) => void | Promise<void>;
      /** Include tool input payloads in audit lines. Default false (privacy-safe). */
      includeToolInput?: boolean | undefined;
      /** Include tool output payloads in audit lines. Default false (privacy-safe). */
      includeToolOutput?: boolean | undefined;
      /** Optional redactor applied to audit events before JSON serialization. */
      redactor?: Redactor | undefined;
      /** Custom timestamp provider for deterministic testing. */
      timestamp?: (() => string) | undefined;
    };

export function jsonlHook<Output = unknown, RawResponse = unknown>(
  options: JsonlHookOptions,
): AgentLifecycle<Output, RawResponse> {
  let writer: (line: string, event: AuditEvent) => Promise<void>;

  if (options.write !== undefined) {
    const customWrite = options.write;
    writer = async (line, event) => {
      await customWrite(line, event);
    };
  } else {
    const rawPath = options.filePath;

    if (typeof rawPath !== "string" || rawPath.trim().length === 0) {
      throw new TypeError("jsonlHook requires either a write callback or a non-empty filePath.");
    }

    const targetPath = rawPath.trim();
    const dir = path.dirname(targetPath);
    let dirCreated = false;
    let queue: Promise<void> = Promise.resolve();

    writer = (line) => {
      const task = queue.then(async () => {
        if (!dirCreated) {
          await mkdir(dir, { recursive: true });
          dirCreated = true;
        }

        await appendFile(targetPath, line, "utf8");
      });
      queue = task.catch(() => undefined);
      return task;
    };
  }

  return auditHook<Output, RawResponse>({
    includeToolInput: options.includeToolInput,
    includeToolOutput: options.includeToolOutput,
    timestamp: options.timestamp,
    async onEvent(event) {
      const payload = options.redactor === undefined ? event : options.redactor.redact(event);
      const serialized = `${safeStringify(payload)}\n`;
      await writer(serialized, payload as AuditEvent);
    },
  });
}

function safeStringify(value: unknown): string {
  const normalized = sanitizeForJson(value, new WeakSet<object>());
  return JSON.stringify(normalized) ?? "null";
}

function sanitizeForJson(value: unknown, ancestors: WeakSet<object>): unknown {
  if (typeof value === "bigint") {
    return value.toString();
  }

  if (value === null || typeof value !== "object") {
    return value;
  }

  if (ancestors.has(value)) {
    return "[Circular]";
  }

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }

  if (value instanceof Error) {
    return { name: value.name, message: value.message };
  }

  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      return value.map((item) => sanitizeForJson(item, ancestors));
    }

    const out: Record<string, unknown> = {};

    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (item !== undefined) {
        out[key] = sanitizeForJson(item, ancestors);
      }
    }

    return out;
  } finally {
    ancestors.delete(value);
  }
}
