import { readFile, writeFile } from "node:fs/promises";
import { generateSpeech } from "@anvia/core/speech-generation";
import { transcribe } from "@anvia/core/transcription";
import { OpenAIClient } from "@anvia/openai";

const client = new OpenAIClient({
  baseUrl: process.env.OPENAI_BASEURL,
  apiKey: process.env.OPENAI_API_KEY ?? "",
});

const speech = await generateSpeech({
  model: client.speechGenerationModel({ modelId: "gpt-4o-mini-tts" }),
  text: "Anvia can now generate speech and transcribe audio through provider-neutral APIs.",
  voice: "alloy",
  speed: 1,
  providerOptions: { response_format: "mp3" },
});

await writeFile("openai-speech.mp3", speech.audio.data);

const audioPath = process.env.ANVIA_AUDIO_FILE ?? "openai-speech.mp3";
const transcript = await transcribe({
  model: client.transcriptionModel({ modelId: "gpt-4o-mini-transcribe" }),
  audio: { data: await readFile(audioPath), filename: audioPath },
  prompt: "Transcribe the audio exactly.",
  temperature: 0,
});

console.log({
  audio: "openai-speech.mp3",
  mediaType: speech.audio.mediaType,
  transcript: transcript.text,
});
