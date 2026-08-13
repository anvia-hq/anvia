import { writeFile } from "node:fs/promises";
import { generateImage } from "@anvia/core/image-generation";
import { GPT_IMAGE_2, OpenAIClient } from "@anvia/openai";

const client = new OpenAIClient({
  baseUrl: process.env.OPENAI_BASEURL,
  apiKey: process.env.OPENAI_API_KEY,
});
const imageModel = client.imageGenerationModel(process.env.OPENAI_IMAGE_MODEL ?? GPT_IMAGE_2);

const response = await generateImage(
  "A clean product illustration of a document ingestion pipeline",
  {
    model: imageModel,
    width: 1024,
    height: 1024,
    additionalParams: { output_format: "png" },
  },
);

await writeFile("openai-image-generation.png", response.image);
console.log({
  images: response.images.length,
  mediaType: response.mediaType,
  output: "openai-image-generation.png",
});
