import type { LangfuseScoreArgs } from "./types.js";

export class LangfuseScoreError extends Error {
  readonly scores: LangfuseScoreArgs[];
  override readonly cause?: unknown;

  constructor(message: string, scores: LangfuseScoreArgs[], cause?: unknown) {
    super(message);
    this.name = "LangfuseScoreError";
    this.scores = scores;
    if (cause !== undefined) {
      this.cause = cause;
    }
  }
}

export type ScoreQueueOptions = {
  baseUrl: string;
  publicKey: string;
  secretKey: string;
  timeoutMs: number;
  batchSize: number;
  flushIntervalMs: number;
  maxRetries: number;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  setTimer?: (handler: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
};

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const defaultSetTimer = (handler: () => void, ms: number): unknown => setTimeout(handler, ms);
const defaultClearTimer = (handle: unknown): void => {
  clearTimeout(handle as ReturnType<typeof setTimeout>);
};

export function computeBackoff(attempt: number, jitter: number = Math.random()): number {
  const base = 200;
  const exponential = base * 2 ** attempt;
  const capped = Math.min(exponential, 5_000);
  const jitterAmount = capped * 0.25 * (jitter * 2 - 1);
  return Math.max(0, Math.round(capped + jitterAmount));
}

export class ScoreQueue {
  private readonly pending: LangfuseScoreArgs[] = [];
  private timer: unknown = null;
  private flushing: Promise<void> | null = null;
  private readonly baseUrl: string;
  private readonly publicKey: string;
  private readonly secretKey: string;
  private readonly timeoutMs: number;
  private readonly batchSize: number;
  private readonly flushIntervalMs: number;
  private readonly maxRetries: number;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly setTimer: (handler: () => void, ms: number) => unknown;
  private readonly clearTimer: (handle: unknown) => void;

  constructor(options: ScoreQueueOptions) {
    this.baseUrl = options.baseUrl;
    this.publicKey = options.publicKey;
    this.secretKey = options.secretKey;
    this.timeoutMs = options.timeoutMs;
    this.batchSize = options.batchSize;
    this.flushIntervalMs = options.flushIntervalMs;
    this.maxRetries = options.maxRetries;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.sleep = options.sleep ?? defaultSleep;
    this.setTimer = options.setTimer ?? defaultSetTimer;
    this.clearTimer = options.clearTimer ?? defaultClearTimer;
  }

  enqueue(score: LangfuseScoreArgs): void {
    this.pending.push(score);
    if (this.pending.length >= this.batchSize) {
      void this.flush();
      return;
    }
    this.scheduleTimer();
  }

  depth(): number {
    return this.pending.length;
  }

  async flush(): Promise<void> {
    if (this.flushing !== null) {
      await this.flushing;
      return;
    }
    if (this.pending.length === 0) {
      this.clearScheduledTimer();
      return;
    }
    const batch = this.pending.splice(0, this.pending.length);
    this.clearScheduledTimer();
    this.flushing = this.sendBatch(batch).finally(() => {
      this.flushing = null;
    });
    await this.flushing;
  }

  async shutdown(): Promise<void> {
    this.clearScheduledTimer();
    await this.flush();
  }

  private scheduleTimer(): void {
    if (this.timer !== null) {
      return;
    }
    this.timer = this.setTimer(() => {
      this.timer = null;
      void this.flush();
    }, this.flushIntervalMs);
  }

  private clearScheduledTimer(): void {
    if (this.timer !== null) {
      this.clearTimer(this.timer);
      this.timer = null;
    }
  }

  private async sendBatch(scores: LangfuseScoreArgs[]): Promise<void> {
    const body = scores.map((score) => buildScoreBody(score));
    let lastError: unknown;
    for (let attempt = 0; attempt < this.maxRetries; attempt += 1) {
      try {
        const response = await this.fetchImpl(`${this.baseUrl}/api/public/scores`, {
          method: "POST",
          headers: {
            Authorization: `Basic ${Buffer.from(`${this.publicKey}:${this.secretKey}`).toString("base64")}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(this.timeoutMs),
        });
        if (response.ok) {
          return;
        }
        if (response.status === 429 || response.status >= 500) {
          lastError = new Error(`Langfuse score batch failed with HTTP ${response.status}`);
        } else {
          const text = await response.text();
          throw new LangfuseScoreError(
            `Langfuse score batch failed with HTTP ${response.status}: ${text}`,
            scores,
          );
        }
      } catch (error) {
        if (error instanceof LangfuseScoreError) {
          throw error;
        }
        lastError = error;
      }
      if (attempt < this.maxRetries - 1) {
        await this.sleep(computeBackoff(attempt));
      }
    }
    throw new LangfuseScoreError(
      `Langfuse score batch failed after ${this.maxRetries} attempts`,
      scores,
      lastError,
    );
  }
}

function buildScoreBody(score: LangfuseScoreArgs): Record<string, unknown> {
  const body: Record<string, unknown> = {
    traceId: score.traceId,
    name: score.name,
    value: score.value,
  };
  if (score.observationId !== undefined) body.observationId = score.observationId;
  if (score.dataType !== undefined) body.dataType = score.dataType;
  if (score.comment !== undefined) body.comment = score.comment;
  if (score.metadata !== undefined) body.metadata = score.metadata;
  const configId = score.configId ?? score.scoreConfigId;
  if (configId !== undefined) body.configId = configId;
  if (score.environment !== undefined) body.environment = score.environment;
  if (score.timestamp !== undefined) {
    body.timestamp =
      score.timestamp instanceof Date ? score.timestamp.toISOString() : score.timestamp;
  }
  return body;
}
