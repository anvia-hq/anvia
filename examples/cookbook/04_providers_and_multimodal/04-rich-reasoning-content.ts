import { AgentBuilder } from "@anvia/core/agent";
import type {
  AssistantContent as AssistantContentType,
  Reasoning,
  ReasoningContent,
  ReasoningContentType,
} from "@anvia/core/completion";
import { GeminiClient } from "@anvia/gemini";
import { OpenAIClient } from "@anvia/openai";

const provider = process.env.ANVIA_REASONING_PROVIDER ?? "openai";
const prompt = "Solve 19 * 23 and explain only the final answer.";

const geminiClient = new GeminiClient({ apiKey: process.env.GEMINI_API_KEY });
const openAIClient = new OpenAIClient({ apiKey: process.env.OPENAI_API_KEY });

const geminiModel = geminiClient.completionModel(
  process.env.GEMINI_MODEL ?? "gemini-3.1-flash-lite-preview",
);
const openAIModel = openAIClient.completionModel(process.env.OPENAI_MODEL ?? "gpt-5.5");

const additionalParams =
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

const agent = new AgentBuilder("reasoning-demo", model).additionalParams(additionalParams).build();

let activeReasoningContentType: ReasoningContentType | undefined;
let wroteReasoning = false;
let wroteText = false;

for await (const event of agent.prompt(prompt).stream()) {
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
    const reasoning = event.messages
      .flatMap((message) => (message.role === "assistant" ? message.content : []))
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

function isReasoning(content: AssistantContentType): content is Reasoning {
  return content.type === "reasoning";
}

function summarizeReasoning(reasoning: Reasoning): Reasoning {
  if (reasoning.content === undefined) {
    return reasoning;
  }

  return {
    ...reasoning,
    content: reasoning.content.map(summarizeReasoningContent),
  };
}

function summarizeReasoningContent(content: ReasoningContent): ReasoningContent {
  if (content.type === "encrypted" || content.type === "redacted") {
    return {
      type: content.type,
      data: `<${content.type} content: ${content.data.length} chars>`,
    };
  }

  return content;
}
