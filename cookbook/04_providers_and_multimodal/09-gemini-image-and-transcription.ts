import { readFile, writeFile } from "node:fs/promises";
import { generateImage } from "@anvia/core/image-generation";
import { transcribe } from "@anvia/core/transcription";
import { GEMINI_2_5_FLASH_IMAGE, GeminiClient } from "@anvia/gemini";

const apiKey = requireEnv("GEMINI_API_KEY");
const client = new GeminiClient({ apiKey });
const imageModel = client.imageGenerationModel({
  api: "generateContent",
  modelId: process.env.GEMINI_IMAGE_MODEL ?? GEMINI_2_5_FLASH_IMAGE,
});

const image = await generateImage({
  model: imageModel,
  prompt: "A minimal technical diagram showing audio, image, and text model interfaces",
  width: 1024,
  height: 1024,
  providerOptions: { config: { imageConfig: { imageSize: "1K" } } },
});

await writeFile("gemini-image-generation.png", image.images[0].data);

const audioPath = process.env.ANVIA_AUDIO_FILE ?? "assets/audio/voice.wav";
const transcript = await transcribe({
  model: client.transcriptionModel({ modelId: "gemini-2.5-flash" }),
  audio: { data: await readFile(audioPath), filename: audioPath },
  prompt: "Return only the transcript.",
  temperature: 0,
});

console.log({
  image: "gemini-image-generation.png",
  imageMediaType: image.images[0].mediaType,
  transcript: transcript.text,
});

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.length === 0) {
    throw new Error(`Set ${name} before running this cookbook example.`);
  }
  return value;
}
