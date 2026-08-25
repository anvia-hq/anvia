import {
  Agent,
  type CompletionModel,
  type CompletionRequest,
  type CompletionResponse,
  Usage,
} from "@anvia/core";
import { agentEvalTarget, contains, runEvalSuite } from "@anvia/core/evals";
import { LangfuseClient } from "@anvia/langfuse";
import { createProcessShutdownSignal } from "./_support/process-shutdown";

class StaticCompletionModel implements CompletionModel {
  readonly provider = "cookbook";
  readonly modelId = "static";
  readonly capabilities = {
    streaming: false,
    tools: false,
    toolChoice: false,
    imageInput: false,
    documentInput: false,
    outputSchema: false,
    reasoning: false,
  };

  async completion(_request: CompletionRequest): Promise<CompletionResponse> {
    return {
      choice: [{ type: "text", text: "Refunds are available for 30 days after purchase." }],
      usage: Usage.empty(),
      rawResponse: {},
    };
  }
}

const langfuse = new LangfuseClient({
  publicKey: process.env.LANGFUSE_PUBLIC_KEY,
  secretKey: process.env.LANGFUSE_SECRET_KEY,
  baseUrl: process.env.LANGFUSE_BASE_URL,
});
const reporter = langfuse.evalReporter();

const agent = new Agent({
  id: "support-agent",
  model: new StaticCompletionModel(),
  instructions: "Answer support questions from policy.",
});

const shutdown = createProcessShutdownSignal();
try {
  const result = await runEvalSuite({
    name: "support-agent-regression",
    cases: [
      {
        id: "refund-window",
        input: "How long do refunds stay available?",
        expected: "30 days",
        metadata: {
          traceId: "trace-from-existing-run",
          observationId: "observation-from-existing-run",
        },
      },
    ],
    target: agentEvalTarget<string>({
      agent,
      request: ({ input }) => ({ prompt: input, abortSignal: shutdown.signal }),
    }),
    metrics: [contains()],
    reporters: [reporter],
  });

  console.log(result.results[0]?.metrics[0]);
} finally {
  shutdown.dispose();
  await langfuse.close();
}
