import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  Agent,
  AgentRunCancelledError,
  AssistantContent,
  type CompletionModel,
  type CompletionModelCapabilities,
  type CompletionRequest,
  type CompletionResponse,
  createTool,
  generateCompletion,
  generateImage,
  generateSpeech,
  type ImageGenerationModel,
  type ModelCallOptions,
  type SpeechGenerationModel,
  type StreamingCompletionModel,
  streamCompletion,
  type TranscriptionModel,
  transcribe,
  Usage,
} from "./helpers/imports";

const capabilities: CompletionModelCapabilities = {
  streaming: true,
  tools: true,
  toolChoice: true,
  imageInput: true,
  documentInput: true,
  outputSchema: true,
  reasoning: true,
};

describe("model call cancellation", () => {
  it("passes the caller AbortSignal to direct completion model calls", async () => {
    const signals: Array<AbortSignal | undefined> = [];
    const model: StreamingCompletionModel = {
      provider: "test",
      modelId: "test",
      capabilities,
      async completion(_request, options) {
        signals.push(options?.abortSignal);
        return response("done");
      },
      async *streamCompletion(_request, options) {
        signals.push(options?.abortSignal);
        yield { type: "final", response: response("done") };
      },
    };
    const controller = new AbortController();

    await generateCompletion({ model, prompt: "hello", abortSignal: controller.signal });
    await collect(streamCompletion({ model, prompt: "hello", abortSignal: controller.signal }));

    expect(signals).toEqual([controller.signal, controller.signal]);
  });

  it("passes the caller AbortSignal to all direct media model calls", async () => {
    const signals: Array<AbortSignal | undefined> = [];
    const imageModel: ImageGenerationModel = {
      provider: "test",
      modelId: "test-image",
      async imageGeneration(_request, options) {
        signals.push(options?.abortSignal);
        return { images: [{ data: new Uint8Array([1]) }], rawResponse: {} };
      },
    };
    const speechModel: SpeechGenerationModel = {
      provider: "test",
      modelId: "test-speech",
      async speechGeneration(_request, options) {
        signals.push(options?.abortSignal);
        return { audio: { data: new Uint8Array([1]) }, rawResponse: {} };
      },
    };
    const transcriptionModel: TranscriptionModel = {
      provider: "test",
      modelId: "test-transcription",
      async transcription(_request, options) {
        signals.push(options?.abortSignal);
        return { text: "done", rawResponse: {} };
      },
    };
    const controller = new AbortController();

    await generateImage({ model: imageModel, prompt: "draw", abortSignal: controller.signal });
    await generateSpeech({
      model: speechModel,
      text: "hello",
      voice: "alloy",
      abortSignal: controller.signal,
    });
    await transcribe({
      model: transcriptionModel,
      audio: { data: new Uint8Array([1]), filename: "audio.wav" },
      abortSignal: controller.signal,
    });

    expect(signals).toEqual([controller.signal, controller.signal, controller.signal]);
  });

  it("does not retry a direct call after its signal is aborted", async () => {
    const controller = new AbortController();
    let calls = 0;
    const model: CompletionModel = {
      provider: "test",
      modelId: "test",
      capabilities: { ...capabilities, streaming: false },
      async completion(_request, options) {
        calls += 1;
        expect(options?.abortSignal).toBe(controller.signal);
        controller.abort("stop");
        throw Object.assign(new Error("provider unavailable"), { status: 503 });
      },
    };

    await expect(
      generateCompletion({
        model,
        prompt: "hello",
        abortSignal: controller.signal,
        retries: { maxAttempts: 3, initialDelayMs: 0, maxDelayMs: 0 },
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(calls).toBe(1);
  });

  it("links Agent cancellation to providers and never retries the aborted turn", async () => {
    const controller = new AbortController();
    const providerSignals: AbortSignal[] = [];
    let calls = 0;
    const model: CompletionModel = {
      provider: "test",
      modelId: "test",
      capabilities: { ...capabilities, streaming: false },
      async completion(_request, options) {
        calls += 1;
        if (options?.abortSignal !== undefined) providerSignals.push(options.abortSignal);
        controller.abort("caller stopped");
        throw Object.assign(new Error("provider unavailable"), { status: 503 });
      },
    };
    const agent = new Agent({
      id: "cancelled-agent",
      model,
      retries: { maxAttempts: 3, initialDelayMs: 0, maxDelayMs: 0 },
    });

    await expect(
      agent.generate({ prompt: "hello", abortSignal: controller.signal }),
    ).rejects.toBeInstanceOf(AgentRunCancelledError);
    expect(calls).toBe(1);
    expect(providerSignals).toHaveLength(1);
    expect(providerSignals[0]?.aborted).toBe(true);
  });

  it("passes Agent cancellation to active tools", async () => {
    const controller = new AbortController();
    let toolSignal: AbortSignal | undefined;
    let signalReady!: () => void;
    const ready = new Promise<void>((resolve) => {
      signalReady = resolve;
    });
    const tool = createTool({
      name: "wait",
      description: "Wait until cancelled.",
      inputSchema: z.object({}),
      async execute(_input, context) {
        toolSignal = context.abortSignal;
        signalReady();
        await new Promise<void>((_resolve, reject) => {
          context.abortSignal?.addEventListener(
            "abort",
            () => reject(context.abortSignal?.reason),
            {
              once: true,
            },
          );
        });
        return "unexpected";
      },
    });
    const model = new CompletionQueueModel([
      responseWithContent([AssistantContent.toolCall("call_1", "wait", {})]),
    ]);
    const agent = new Agent({ id: "tool-agent", model, tools: [tool] });

    const pending = agent.generate({ prompt: "wait", abortSignal: controller.signal });
    await ready;
    controller.abort("caller stopped");

    await expect(pending).rejects.toBeInstanceOf(AgentRunCancelledError);
    expect(toolSignal?.aborted).toBe(true);
  });
});

class CompletionQueueModel implements CompletionModel {
  readonly provider = "test";
  readonly modelId = "test";
  readonly capabilities = { ...capabilities, streaming: false };

  constructor(private readonly responses: CompletionResponse[]) {}

  async completion(
    _request: CompletionRequest,
    _options?: ModelCallOptions,
  ): Promise<CompletionResponse> {
    const next = this.responses.shift();
    if (next === undefined) throw new Error("No queued response.");
    return next;
  }
}

function response(text: string): CompletionResponse {
  return responseWithContent([AssistantContent.text(text)]);
}

function responseWithContent(choice: CompletionResponse["choice"]): CompletionResponse {
  return { choice, usage: Usage.empty(), rawResponse: {} };
}

async function collect<T>(events: AsyncIterable<T>): Promise<T[]> {
  const values: T[] = [];
  for await (const event of events) values.push(event);
  return values;
}
