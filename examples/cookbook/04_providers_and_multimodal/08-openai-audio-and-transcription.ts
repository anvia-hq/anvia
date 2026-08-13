import { readFile, writeFile } from "node:fs/promises";
import { generateSpeech } from "@anvia/core/audio-generation";
import { transcribe } from "@anvia/core/transcription";
import { OpenAIClient } from "@anvia/openai";

const client = new OpenAIClient({
  baseUrl: process.env.OPENAI_BASEURL,
  apiKey: process.env.OPENAI_API_KEY,
});

const speech = await generateSpeech(
  "Anvia can now generate audio and transcribe audio through provider-neutral APIs.",
  {
    model: client.audioGenerationModel(),
    voice: "alloy",
    speed: 1,
    additionalParams: { response_format: "mp3" },
  },
);

await writeFile("openai-speech.mp3", speech.audio);

const audioPath = process.env.ANVIA_AUDIO_FILE ?? "openai-speech.mp3";
const transcript = await transcribe(await readFile(audioPath), {
  model: client.transcriptionModel(),
  filename: audioPath,
  prompt: "Transcribe the audio exactly.",
  temperature: 0,
});

console.log({
  audio: "openai-speech.mp3",
  mediaType: speech.mediaType,
  transcript: transcript.text,
});
