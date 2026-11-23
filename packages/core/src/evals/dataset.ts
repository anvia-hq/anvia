import { z } from "zod";
import type { ZodSchema } from "../schema";
import type { EvalCase } from "./types";

export type LoadEvalCasesFormat = "auto" | "json" | "jsonl";

export type LoadEvalCasesOptions<Input = unknown, Expected = unknown> = {
  format?: LoadEvalCasesFormat | undefined;
  autoId?: boolean | undefined;
  schema?: ZodSchema<EvalCase<Input, Expected>> | undefined;
};

/** Loads eval cases from a JSON or JSONL/NDJSON file with optional Zod validation. */
export async function loadEvalCases<Input = unknown, Expected = unknown>(
  filePath: string,
  options: LoadEvalCasesOptions<Input, Expected> = {},
): Promise<Array<EvalCase<Input, Expected>>> {
  const fs = await import("node:fs/promises");
  const content = await fs.readFile(filePath, "utf8");
  const format = resolveFormat(filePath, options.format ?? "auto");
  const rawRecords = parseRecords(content, format, filePath);

  return rawRecords.map((record, index) => {
    const normalized = normalizeRecord(record, index, options.autoId ?? false, filePath);

    if (options.schema !== undefined) {
      const parsed = options.schema.safeParse(normalized);

      if (!parsed.success) {
        throw new TypeError(
          `Eval case at index ${index} in ${filePath} failed schema validation:\n${z.prettifyError(parsed.error)}`,
        );
      }

      return parsed.data;
    }

    return normalized as EvalCase<Input, Expected>;
  });
}

function resolveFormat(filePath: string, requested: LoadEvalCasesFormat): "json" | "jsonl" {
  if (requested !== "auto") return requested;

  const lower = filePath.toLowerCase();

  if (lower.endsWith(".jsonl") || lower.endsWith(".ndjson")) return "jsonl";

  return "json";
}

function parseRecords(content: string, format: "json" | "jsonl", filePath: string): unknown[] {
  if (format === "jsonl") {
    const lines = content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    return lines.map((line, index) => {
      try {
        return JSON.parse(line) as unknown;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new TypeError(`Invalid JSON on line ${index + 1} of ${filePath}: ${message}`);
      }
    });
  }

  const parsed: unknown = JSON.parse(content);

  if (Array.isArray(parsed)) return parsed;

  if (
    typeof parsed === "object" &&
    parsed !== null &&
    "cases" in parsed &&
    Array.isArray((parsed as { cases?: unknown }).cases)
  ) {
    return (parsed as { cases: unknown[] }).cases;
  }

  throw new TypeError(
    `Eval dataset ${filePath} must be a JSON array or an object with a cases array.`,
  );
}

function normalizeRecord(
  record: unknown,
  index: number,
  autoId: boolean,
  filePath: string,
): Record<string, unknown> {
  if (typeof record !== "object" || record === null || Array.isArray(record)) {
    throw new TypeError(`Eval case at index ${index} in ${filePath} must be a JSON object.`);
  }

  const entry: Record<string, unknown> = { ...(record as Record<string, unknown>) };

  if (typeof entry.id !== "string" || entry.id.trim().length === 0) {
    if (autoId) {
      entry.id = `case-${index + 1}`;
    } else {
      throw new TypeError(
        `Eval case at index ${index} in ${filePath} is missing a non-empty string id.`,
      );
    }
  }

  if (!Object.hasOwn(entry, "input")) {
    throw new TypeError(
      `Eval case "${String(entry.id)}" in ${filePath} is missing an input field.`,
    );
  }

  return entry;
}
