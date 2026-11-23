import { Agent } from "@anvia/core/agent";
import {
  agentEvalTarget,
  contains,
  maxTurns,
  notBlank,
  printEvalResult,
  runEvalSuite,
} from "@anvia/core/evals";
import { OpenAIClient } from "@anvia/openai";

const openAIClient = new OpenAIClient({
  baseUrl: process.env.OPENAI_BASEURL,
  apiKey: process.env.OPENAI_API_KEY ?? "",
});
const model = openAIClient.completionModel({ modelId: "gpt-5.5", api: "responses" });

const agent = new Agent({
  id: "support-policy-agent",
  model: model,
  instructions: [
    "Answer with only the relevant policy fact.",
    "Use these exact policy phrases when relevant:",
    "- Refunds are available for 30 days.",
    "- Workspace owners can change billing settings.",
  ].join("\n"),
});

const cases = [
  {
    id: "refund-window",
    input: "When can I request a refund?",
    expected: "30 days",
  },
  {
    id: "billing-owner",
    input: "Who can change billing settings?",
    expected: "Workspace owners",
  },
];

const result = await runEvalSuite({
  name: "support-agent-target",
  cases,
  target: agentEvalTarget(agent),
  metrics: [contains(), notBlank(), maxTurns(2)],
});

printEvalResult(result);
