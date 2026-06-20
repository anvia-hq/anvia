import { AgentBuilder } from "@anvia/core";
import { OpenAIClient } from "@anvia/openai";
import { Studio } from "@anvia/studio";

const openaiModel = new OpenAIClient({ apiKey: "test" }).completionModel("gpt-5");

const agent = new AgentBuilder("assistant", openaiModel)
  .name("assistant")
  .description("An assistant that can answer questions.")
  .instructions("You are a helpful assistant.")
  .build();

new Studio([agent]).start();
