import { createTool, createToolkit, type Toolkit, type ToolkitOptions } from "@anvia/core/tool";
import { z } from "zod";

export type DatetimeToolName = "current_time" | "convert_timezone" | "date_math";

export type DatetimeOptions = ToolkitOptions<DatetimeToolName> & {
  /** Default IANA time zone (e.g. `"UTC"`, `"Asia/Jakarta"`). Default `"UTC"`. */
  defaultTimeZone?: string | undefined;
  /** Custom clock for deterministic testing. Default `() => new Date()`. */
  now?: (() => Date) | undefined;
};

const DEFAULT_INSTRUCTIONS =
  "Use datetime tools when you need the current date/time, timezone conversions, or exact calendar math.";

const ISO_TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/i;

const UNIT_MS: Record<"seconds" | "minutes" | "hours" | "days" | "weeks", number> = {
  seconds: 1_000,
  minutes: 60_000,
  hours: 3_600_000,
  days: 86_400_000,
  weeks: 604_800_000,
};

export function datetime(options: DatetimeOptions = {}): Toolkit {
  const defaultTimeZone = validateTimeZone(options.defaultTimeZone ?? "UTC");
  const getNow = options.now ?? (() => new Date());

  const currentTimeTool = createTool({
    name: "current_time",
    description: "Get the current date and time in UTC and an optional IANA timezone.",
    inputSchema: z.object({
      timeZone: z
        .string()
        .optional()
        .describe("IANA timezone name (e.g. 'America/New_York', 'UTC')."),
    }),
    handler(args) {
      const tz = validateTimeZone(args.timeZone ?? defaultTimeZone);
      const current = getNow();

      if (!(current instanceof Date) || Number.isNaN(current.getTime())) {
        throw new Error("datetime clock returned an invalid Date.");
      }

      return formatTimestampInZone(current, tz);
    },
  });

  const convertTimezoneTool = createTool({
    name: "convert_timezone",
    description: "Convert an ISO-8601 timestamp into another IANA timezone.",
    inputSchema: z.object({
      timestamp: z.string().min(1).describe("ISO-8601 timestamp to convert."),
      toTimeZone: z.string().min(1).describe("Target IANA timezone name."),
    }),
    handler(args) {
      const date = parseTimestamp(args.timestamp);
      const tz = validateTimeZone(args.toTimeZone);
      return formatTimestampInZone(date, tz);
    },
  });

  const dateMathTool = createTool({
    name: "date_math",
    description:
      "Add or subtract durations from a timestamp, or compute the difference between two timestamps.",
    inputSchema: z.object({
      timestamp: z.string().min(1).describe("Base ISO-8601 timestamp."),
      operation: z.enum(["add", "subtract", "diff"]).describe("Operation to perform."),
      amount: z
        .number()
        .int()
        .optional()
        .describe("Integer duration amount (required for add/subtract)."),
      unit: z
        .enum(["seconds", "minutes", "hours", "days", "weeks", "months", "years"])
        .optional()
        .describe("Duration unit (required for add/subtract; ignored for diff)."),
      otherTimestamp: z
        .string()
        .optional()
        .describe("Second ISO-8601 timestamp (required for diff: otherTimestamp - timestamp)."),
    }),
    handler(args) {
      const base = parseTimestamp(args.timestamp);

      if (args.operation === "diff") {
        if (args.otherTimestamp === undefined) {
          throw new Error("date_math diff operation requires otherTimestamp.");
        }

        const other = parseTimestamp(args.otherTimestamp);
        const diffMs = other.getTime() - base.getTime();
        return {
          from: base.toISOString(),
          to: other.toISOString(),
          milliseconds: diffMs,
          seconds: diffMs / 1_000,
          minutes: diffMs / 60_000,
          hours: diffMs / 3_600_000,
          days: diffMs / 86_400_000,
        };
      }

      if (args.amount === undefined || args.unit === undefined) {
        throw new Error(`date_math ${args.operation} operation requires amount and unit.`);
      }

      const signedAmount = args.operation === "subtract" ? -args.amount : args.amount;
      const shifted = applyDateDelta(base, signedAmount, args.unit);
      return {
        input: base.toISOString(),
        result: shifted.toISOString(),
        epochMs: shifted.getTime(),
      };
    },
  });

  const toolkitOptions: ToolkitOptions<DatetimeToolName> = {
    instructions: options.instructions ?? DEFAULT_INSTRUCTIONS,
  };

  if (options.include !== undefined) toolkitOptions.include = options.include;

  if (options.exclude !== undefined) toolkitOptions.exclude = options.exclude;

  if (options.prefix !== undefined) toolkitOptions.prefix = options.prefix;

  if (options.requiresApproval !== undefined) {
    toolkitOptions.requiresApproval = options.requiresApproval;
  }

  if (options.timeoutMs !== undefined) toolkitOptions.timeoutMs = options.timeoutMs;

  return createToolkit(
    {
      name: "datetime",
      tools: [currentTimeTool, convertTimezoneTool, dateMathTool],
    },
    toolkitOptions,
  );
}

function validateTimeZone(timeZone: string): string {
  const trimmed = timeZone.trim();

  if (trimmed.length === 0) {
    throw new TypeError("timeZone must not be empty.");
  }

  try {
    new Intl.DateTimeFormat("en-US", { timeZone: trimmed });
  } catch {
    throw new RangeError(`Invalid IANA timeZone "${timeZone}".`);
  }

  return trimmed;
}

function parseTimestamp(raw: string): Date {
  const trimmed = raw.trim();

  if (!ISO_TIMESTAMP_PATTERN.test(trimmed)) {
    throw new Error(`Invalid timestamp "${raw}". Expected an ISO-8601 date string.`);
  }

  const hasTime = trimmed.includes("T") || trimmed.includes("t") || trimmed.includes(" ");
  const hasOffset = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(trimmed);
  const normalized = hasTime && !hasOffset ? `${trimmed.replace(" ", "T")}Z` : trimmed;
  const parsed = new Date(normalized);

  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid timestamp "${raw}". Expected an ISO-8601 date string.`);
  }

  return parsed;
}

function formatTimestampInZone(
  date: Date,
  timeZone: string,
): {
  isoUtc: string;
  epochMs: number;
  timeZone: string;
  formatted: string;
  weekday: string;
  offset: string;
} {
  const partsFormatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    weekday: "long",
    timeZoneName: "shortOffset",
  });
  const parts = partsFormatter.formatToParts(date);
  const byType = new Map(parts.map((part) => [part.type, part.value]));
  const year = byType.get("year") ?? "0000";
  const month = byType.get("month") ?? "01";
  const day = byType.get("day") ?? "01";
  const rawHour = byType.get("hour") ?? "00";
  const hour = rawHour === "24" ? "00" : rawHour;
  const minute = byType.get("minute") ?? "00";
  const second = byType.get("second") ?? "00";
  const weekday = byType.get("weekday") ?? "";
  const offset = byType.get("timeZoneName") ?? "UTC";

  return {
    isoUtc: date.toISOString(),
    epochMs: date.getTime(),
    timeZone,
    formatted: `${year}-${month}-${day} ${hour}:${minute}:${second}`,
    weekday,
    offset,
  };
}

function applyDateDelta(
  base: Date,
  signedAmount: number,
  unit: "seconds" | "minutes" | "hours" | "days" | "weeks" | "months" | "years",
): Date {
  let shifted: Date;

  if (unit === "months" || unit === "years") {
    const monthDelta = unit === "years" ? signedAmount * 12 : signedAmount;
    const totalMonths = base.getUTCFullYear() * 12 + base.getUTCMonth() + monthDelta;
    const targetYear = Math.floor(totalMonths / 12);
    const targetMonth = ((totalMonths % 12) + 12) % 12;

    const endOfMonth = new Date(0);
    endOfMonth.setUTCFullYear(targetYear, targetMonth + 1, 0);
    const lastDayOfTargetMonth = endOfMonth.getUTCDate();
    const clampedDay = Math.min(base.getUTCDate(), lastDayOfTargetMonth);

    shifted = new Date(0);
    shifted.setUTCFullYear(targetYear, targetMonth, clampedDay);
    shifted.setUTCHours(
      base.getUTCHours(),
      base.getUTCMinutes(),
      base.getUTCSeconds(),
      base.getUTCMilliseconds(),
    );
  } else {
    shifted = new Date(base.getTime() + signedAmount * UNIT_MS[unit]);
  }

  if (Number.isNaN(shifted.getTime())) {
    throw new RangeError("Resulting date is out of valid JavaScript Date range.");
  }

  return shifted;
}
