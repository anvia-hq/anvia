import { readFile, writeFile } from "node:fs/promises";
import { imageGenerationRequest } from "@anvia/core/image-generation";
import { transcriptionRequest } from "@anvia/core/transcription";
import { GEMINI_2_5_FLASH_IMAGE, GeminiClient } from "@anvia/gemini";

const apiKey = requireEnv("GEMINI_API_KEY");
const client = new GeminiClient({ apiKey });
const imageModel = client.imageGenerationModel(
  process.env.GEMINI_IMAGE_MODEL ?? GEMINI_2_5_FLASH_IMAGE,
);

const image = await imageGenerationRequest(imageModel)
  .prompt("A minimal technical diagram showing audio, image, and text model interfaces")
  .width(1024)
  .height(1024)
  .additionalParams({ config: { imageConfig: { imageSize: "1K" } } })
  .send();

await writeFile("gemini-image-generation.png", image.image);

const audioPath = process.env.ANVIA_AUDIO_FILE ?? "assets/audio/voice.wav";
const transcript = await transcriptionRequest(client.transcriptionModel())
  .data(await readFile(audioPath))
  .filename(audioPath)
  .prompt("Return only the transcript.")
  .temperature(0)
  .send();

console.log({
  image: "gemini-image-generation.png",
  imageMediaType: image.mediaType,
  transcript: transcript.text,
});

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.length === 0) {
    throw new Error(`Set ${name} before running this cookbook example.`);
  }
  return value;
}
