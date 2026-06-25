// Demonstrates: catching LangfuseScoreError. To force a failure, point
// the queue at an invalid baseUrl so the POST returns a non-2xx. The
// error exposes the failed scores on `.scores` and the cause on `.cause`.

import { LangfuseScoreError, langfuse } from "@anvia/langfuse";
import { getLangfuseEnv } from "../_support/env.js";

async function main(): Promise<void> {
  const env = getLangfuseEnv();
  // Force failure: send to a clearly invalid host so the POST errors.
  const tracing = langfuse.create({
    publicKey: env.publicKey,
    secretKey: env.secretKey,
    baseUrl: "https://langfuse.invalid.example",
    scoreBatchSize: 1,
    scoreMaxRetries: 1,
  });
  try {
    const fakeTraceId = "00000000-0000-0000-0000-000000000004";
    try {
      await tracing.score({
        traceId: fakeTraceId,
        name: "will-fail",
        value: 0.5,
      });
      await tracing.flushScores();
    } catch (error: unknown) {
      if (error instanceof LangfuseScoreError) {
        console.log(
          "[scoring:04] caught LangfuseScoreError, lost scores:",
          error.scores.length,
          "cause:",
          error.cause,
        );
      } else {
        throw error;
      }
    }
  } finally {
    await tracing.shutdown();
  }
}

main().catch((error: unknown) => {
  console.error("[scoring:04] failed:", error);
  process.exit(1);
});
