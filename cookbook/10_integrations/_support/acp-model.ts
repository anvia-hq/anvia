import { OpenAIClient } from "@anvia/openai";
import { config } from "dotenv";
import { fileURLToPath } from "node:url";

// Resolve from this file so editor cwd and shell dotenv preloads are irrelevant.
// Called by the factory, never on import; quiet keeps stdout safe outside the launcher too.
export function createAcpModel() {
  config({ path: fileURLToPath(new URL("../../../.env", import.meta.url)), quiet: true });
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.error("ACP cookbook: set OPENAI_API_KEY in the repository-root .env or environment.");
    throw new Error("ACP cookbook provider configuration is missing.");
  }
  const client = new OpenAIClient({ apiKey, baseUrl: process.env.OPENAI_BASEURL });
  return client.completionModel({
    modelId: process.env.ANVIA_ACP_MODEL ?? "gpt-5.5",
    api: "responses",
  });
}
