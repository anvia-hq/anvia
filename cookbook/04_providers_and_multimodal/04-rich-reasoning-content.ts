import { Agent } from "@anvia/core/agent";
import type {
  AssistantContentPart,
  ReasoningContentType,
  ReasoningDetail,
  ReasoningPart,
} from "@anvia/core/completion";
import { GeminiClient } from "@anvia/gemini";
import { OpenAIClient } from "@anvia/openai";

const provider = process.env.ANVIA_REASONING_PROVIDER ?? "openai";
const prompt = "Solve 19 * 23 and explain only the final answer.";

const geminiClient = new GeminiClient({ apiKey: process.env.GEMINI_API_KEY ?? "" });
const openAIClient = new OpenAIClient({
  baseUrl: process.env.OPENAI_BASEURL,
  apiKey: process.env.OPENAI_API_KEY ?? "",
});

const geminiModel = geminiClient.completionModel({
  modelId: process.env.GEMINI_MODEL ?? "gemini-3.1-flash-lite-preview",
});
const openAIModel = openAIClient.completionModel({ modelId: "gpt-5.5", api: "responses" });

const providerOptions =
  provider === "gemini"
    ? {
        config: {
          thinkingConfig: {
            includeThoughts: true,
          },
        },
      }
    : {
        reasoning: {
          summary: "auto",
        },
        include: ["reasoning.encrypted_content"],
      };

const model = provider === "gemini" ? geminiModel : openAIModel;

const agent = new Agent({
  id: "reasoning-demo",
  model: model,
  providerOptions,
});

let activeReasoningContentType: ReasoningContentType | undefined;
let wroteReasoning = false;
let wroteText = false;

for await (const event of agent.stream({ prompt })) {
  if (event.type === "reasoning_delta") {
    writeReasoning(event.contentType, event.delta);
  }

  if (event.type === "text_delta") {
    if (!wroteText && wroteReasoning) {
      process.stderr.write("\n");
    }
    wroteText = true;
    process.stdout.write(event.delta);
  }

  if (event.type === "final") {
    const reasoning = event.result.messages
      .flatMap((message) =>
        message.role === "assistant" && typeof message.content !== "string" ? message.content : [],
      )
      .filter(isReasoning);
    console.log("\nreasoning blocks:", JSON.stringify(reasoning.map(summarizeReasoning), null, 2));
  }
}

function writeReasoning(contentType: ReasoningContentType | undefined, delta: string): void {
  if (contentType === "encrypted" || contentType === "redacted") {
    return;
  }

  if (contentType === "summary") {
    if (activeReasoningContentType !== contentType) {
      process.stderr.write(`${wroteReasoning ? "\n" : ""}[summary]\n`);
    }
  }

  activeReasoningContentType = contentType;
  wroteReasoning = true;
  process.stderr.write(delta);
}

function isReasoning(content: AssistantContentPart): content is ReasoningPart {
  return content.type === "reasoning";
}

function summarizeReasoning(reasoning: ReasoningPart): ReasoningPart {
  if (reasoning.details === undefined) {
    return reasoning;
  }

  return {
    ...reasoning,
    details: reasoning.details.map(summarizeReasoningContent),
  };
}

function summarizeReasoningContent(content: ReasoningDetail): ReasoningDetail {
  if (content.type === "encrypted" || content.type === "redacted") {
    return {
      type: content.type,
      data: `<${content.type} content: ${content.data.length} chars>`,
    };
  }

  return content;
}
