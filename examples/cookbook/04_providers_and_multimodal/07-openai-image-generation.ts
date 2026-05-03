import { writeFile } from "node:fs/promises";
import { imageGenerationRequest } from "@anvia/core/image-generation";
import { GPT_IMAGE_2, OpenAIClient } from "@anvia/openai";

const apiKey = requireEnv("OPENAI_API_KEY");
const client = new OpenAIClient({ apiKey });
const imageModel = client.imageGenerationModel(process.env.OPENAI_IMAGE_MODEL ?? GPT_IMAGE_2);

const response = await imageGenerationRequest(imageModel)
  .prompt("A clean product illustration of a document ingestion pipeline")
  .width(1024)
  .height(1024)
  .additionalParams({ output_format: "png" })
  .send();

await writeFile("openai-image-generation.png", response.image);
console.log({
  images: response.images.length,
  mediaType: response.mediaType,
  output: "openai-image-generation.png",
});

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.length === 0) {
    throw new Error(`Set ${name} before running this cookbook example.`);
  }
  return value;
}
