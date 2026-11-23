import type { EvalOutputFormat } from "./cli";
import type { EvalShard } from "./types";

export type ParsedEvalCliArgs = {
  format?: EvalOutputFormat | undefined;
  caseIds?: string[] | undefined;
  tags?: string[] | undefined;
  concurrency?: number | undefined;
  targetConcurrency?: number | undefined;
  metricConcurrency?: number | undefined;
  caseTimeoutMs?: number | undefined;
  failFast?: boolean | undefined;
  onlyFailures?: boolean | undefined;
  shard?: EvalShard | undefined;
  trials?: number | undefined;
  color?: boolean | undefined;
  progress?: boolean | undefined;
  baselinePath?: string | undefined;
  savePath?: string | undefined;
};

/** Parses CLI flags (such as process.argv.slice(2)) into RunEvalCliOptions overrides. */
export function parseEvalCliArgs(argv: readonly string[]): ParsedEvalCliArgs {
  const parsed: ParsedEvalCliArgs = {};
  const caseIds: string[] = [];
  const tags: string[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (token === undefined || token === "--") continue;

    if (!token.startsWith("-")) continue;

    const eqIndex = token.indexOf("=");
    const flag = eqIndex >= 0 ? token.slice(0, eqIndex) : token;
    const inlineValue = eqIndex >= 0 ? token.slice(eqIndex + 1) : undefined;

    const readValue = (): string => {
      if (inlineValue !== undefined) return inlineValue;

      const next = argv[index + 1];

      if (next === undefined || next.startsWith("-")) {
        throw new TypeError(`Missing value for eval CLI flag ${flag}.`);
      }

      index += 1;
      return next;
    };

    switch (flag) {
      case "--format":
      case "-f": {
        const value = readValue();

        if (value !== "pretty" && value !== "json" && value !== "quiet") {
          throw new TypeError(
            `Invalid eval CLI format: ${value}. Expected pretty, json, or quiet.`,
          );
        }

        parsed.format = value;
        break;
      }
      case "--case":
      case "--cases": {
        caseIds.push(...splitList(readValue()));
        break;
      }
      case "--tag":
      case "--tags": {
        tags.push(...splitList(readValue()));
        break;
      }
      case "--concurrency":
      case "-c": {
        parsed.concurrency = parsePositiveInt(readValue(), flag);
        break;
      }
      case "--target-concurrency": {
        parsed.targetConcurrency = parsePositiveInt(readValue(), flag);
        break;
      }
      case "--metric-concurrency": {
        parsed.metricConcurrency = parsePositiveInt(readValue(), flag);
        break;
      }
      case "--timeout":
      case "--case-timeout": {
        parsed.caseTimeoutMs = parsePositiveInt(readValue(), flag);
        break;
      }
      case "--trials": {
        parsed.trials = parsePositiveInt(readValue(), flag);
        break;
      }
      case "--shard": {
        parsed.shard = parseShard(readValue());
        break;
      }
      case "--fail-fast": {
        parsed.failFast = true;
        break;
      }
      case "--failed-only":
      case "--only-failures": {
        parsed.onlyFailures = true;
        break;
      }
      case "--color": {
        parsed.color = true;
        break;
      }
      case "--no-color": {
        parsed.color = false;
        break;
      }
      case "--progress": {
        parsed.progress = true;
        break;
      }
      case "--no-progress": {
        parsed.progress = false;
        break;
      }
      case "--baseline": {
        parsed.baselinePath = readValue();
        break;
      }
      case "--save": {
        parsed.savePath = readValue();
        break;
      }
      default: {
        throw new TypeError(`Unknown eval CLI flag: ${flag}.`);
      }
    }
  }

  if (caseIds.length > 0) parsed.caseIds = caseIds;

  if (tags.length > 0) parsed.tags = tags;

  return parsed;
}

function splitList(raw: string): string[] {
  return raw
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function parsePositiveInt(raw: string, flag: string): number {
  const value = Number(raw);

  if (!Number.isSafeInteger(value) || value < 1) {
    throw new RangeError(`Eval CLI flag ${flag} must be a positive integer, received ${raw}.`);
  }

  return value;
}

function parseShard(raw: string): EvalShard {
  const parts = raw.split("/");

  if (parts.length !== 2) {
    throw new TypeError(`Invalid eval shard ${raw}. Expected <index>/<count> (0-based index).`);
  }

  const index = Number(parts[0]);
  const count = Number(parts[1]);

  if (!Number.isSafeInteger(count) || count < 1) {
    throw new RangeError(`Eval shard count must be a positive integer, received ${raw}.`);
  }

  if (!Number.isSafeInteger(index) || index < 0 || index >= count) {
    throw new RangeError(`Eval shard index must be between 0 and ${count - 1}, received ${raw}.`);
  }

  return { index, count };
}
