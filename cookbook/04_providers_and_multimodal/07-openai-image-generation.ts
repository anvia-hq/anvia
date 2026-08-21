import { writeFile } from "node:fs/promises";
import { generateImage } from "@anvia/core/image-generation";
import { GPT_IMAGE_2, OpenAIClient } from "@anvia/openai";

const client = new OpenAIClient({
  baseUrl: process.env.OPENAI_BASEURL,
  apiKey: process.env.OPENAI_API_KEY ?? "",
});
const imageModel = client.imageGenerationModel({
  modelId: process.env.OPENAI_IMAGE_MODEL ?? GPT_IMAGE_2,
});

const response = await generateImage({
  model: imageModel,
  prompt: "A clean product illustration of a document ingestion pipeline",
  width: 1024,
  height: 1024,
  providerOptions: { output_format: "png" },
});

await writeFile("openai-image-generation.png", response.images[0].data);
console.log({
  images: response.images.length,
  mediaType: response.images[0].mediaType,
  output: "openai-image-generation.png",
});
