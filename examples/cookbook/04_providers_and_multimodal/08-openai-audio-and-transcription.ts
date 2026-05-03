import { readFile, writeFile } from "node:fs/promises";
import { audioGenerationRequest } from "@anvia/core/audio-generation";
import { transcriptionRequest } from "@anvia/core/transcription";
import { OpenAIClient } from "@anvia/openai";

const apiKey = requireEnv("OPENAI_API_KEY");
const client = new OpenAIClient({ apiKey });

const speech = await audioGenerationRequest(client.audioGenerationModel())
  .text("Anvia can now generate audio and transcribe audio through provider-neutral APIs.")
  .voice("alloy")
  .speed(1)
  .additionalParams({ response_format: "mp3" })
  .send();

await writeFile("openai-speech.mp3", speech.audio);

const audioPath = process.env.ANVIA_AUDIO_FILE ?? "openai-speech.mp3";
const transcript = await transcriptionRequest(client.transcriptionModel())
  .data(await readFile(audioPath))
  .filename(audioPath)
  .prompt("Transcribe the audio exactly.")
  .temperature(0)
  .send();

console.log({
  audio: "openai-speech.mp3",
  mediaType: speech.mediaType,
  transcript: transcript.text,
});

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.length === 0) {
    throw new Error(`Set ${name} before running this cookbook example.`);
  }
  return value;
}
