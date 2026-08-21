import { knowledgeRetention, runEvalSuite, turnRelevancy } from "@anvia/core/evals";
import { OpenAIClient } from "@anvia/openai";

const openAIClient = new OpenAIClient({
  baseUrl: process.env.OPENAI_BASEURL,
  apiKey: process.env.OPENAI_API_KEY ?? "",
});
const judgeModel = openAIClient.completionModel({ modelId: "gpt-5.5", api: "responses" });

const result = await runEvalSuite({
  name: "conversation-quality",
  cases: [{ id: "remember-name", input: "Remember the user's name." }],
  target: async () => [
    { role: "user" as const, content: "My name is Ada." },
    { role: "assistant" as const, content: "Hello Ada." },
    { role: "user" as const, content: "What name did I give you?" },
    { role: "assistant" as const, content: "Your name is Ada." },
  ],
  metrics: [
    turnRelevancy({ model: judgeModel, threshold: 0.8 }),
    knowledgeRetention({ model: judgeModel, threshold: 0.9 }),
  ],
});

console.dir(result, { depth: null });
