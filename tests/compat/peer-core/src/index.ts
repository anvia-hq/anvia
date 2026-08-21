import { Agent } from "@anvia/core";
import { OpenAIClient } from "@anvia/openai";
import { Studio } from "@anvia/studio";

const openaiModel = new OpenAIClient({ apiKey: "test" }).completionModel({
  modelId: "gpt-5",
  api: "responses",
});

const agent = new Agent({
  id: "assistant",
  model: openaiModel,
  name: "assistant",
  description: "An assistant that can answer questions.",
  instructions: "You are a helpful assistant.",
});

new Studio([agent]).start();
