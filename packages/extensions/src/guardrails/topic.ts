import { type CompletionModel } from "@anvia/core/completion";
import {
  allow,
  block,
  defineGuardrailPolicy,
  defineInputGuardrail,
  defineOutputGuardrail,
  type GuardrailMode,
  type GuardrailPolicy,
  type InputGuardrail,
  type OutputGuardrail,
} from "@anvia/core/guardrails";
import { llmGuardrail } from "./llm-judge";
import type { GuardrailBoundarySelection } from "./redaction-guardrails";

export type TopicMatcher = string | RegExp;

export type TopicGuardrailOptions = {
  id?: string | undefined;
  /** Topics explicitly permitted. In heuristic mode, content must match at least one allowed topic. */
  allowedTopics?: readonly TopicMatcher[] | undefined;
  /** Topics explicitly forbidden. Matching any blocked topic blocks the content. */
  blockedTopics?: readonly TopicMatcher[] | undefined;
  /** Optional LLM judge model for semantic topic classification (uses string topic names). */
  model?: CompletionModel | undefined;
  /** Boundary to check. Default `"input"`. */
  boundary?: GuardrailBoundarySelection | undefined;
  /** Policy mode (`"enforce"` or `"observe"`). Default `"enforce"`. */
  mode?: GuardrailMode | undefined;
  /** Reason recorded on guardrail decisions in heuristic mode. */
  reason?: string | undefined;
  /** User-facing message returned when blocked. */
  message?: string | undefined;
  /** Optional temperature override for the optional LLM judge model. */
  temperature?: number | undefined;
  /** Optional maxTokens cap for the optional LLM judge model. Default 256. */
  maxTokens?: number | undefined;
};

const CJK_ONLY_PATTERN = /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\s]+$/u;

export function topicGuardrail(options: TopicGuardrailOptions): GuardrailPolicy {
  const allowedTopics = options.allowedTopics ?? [];
  const blockedTopics = options.blockedTopics ?? [];

  if (allowedTopics.length === 0 && blockedTopics.length === 0) {
    throw new TypeError(
      "topicGuardrail requires at least one allowedTopics or blockedTopics entry.",
    );
  }

  for (const topic of allowedTopics) {
    validateTopic(topic);
  }

  for (const topic of blockedTopics) {
    validateTopic(topic);
  }

  const id = options.id ?? "extensions.topic";
  const boundary = options.boundary ?? "input";
  const mode = options.mode ?? "enforce";
  const defaultReason = "Content outside permitted topics";
  const message = options.message ?? "Content blocked because it falls outside permitted topics.";

  if (options.model !== undefined) {
    const policyLines: string[] = [];

    if (allowedTopics.length > 0) {
      policyLines.push(
        `Only allow content related to these topics: ${allowedTopics.map(describeTopic).join(", ")}.`,
      );
    }

    if (blockedTopics.length > 0) {
      policyLines.push(
        `Block any content related to these forbidden topics: ${blockedTopics.map(describeTopic).join(", ")}.`,
      );
    }

    return llmGuardrail({
      id,
      model: options.model,
      policy: policyLines.join(" "),
      boundary,
      mode,
      message,
      temperature: options.temperature,
      maxTokens: options.maxTokens,
    });
  }

  const compiledAllowed = allowedTopics.map(compileTopicMatcher);
  const compiledBlocked = blockedTopics.map(compileTopicMatcher);

  const checkText = (text: string): { allowed: boolean; detail: string } => {
    for (const matcher of compiledBlocked) {
      if (matcher.test(text)) {
        return {
          allowed: false,
          detail: options.reason ?? `Matched blocked topic "${matcher.label}"`,
        };
      }
    }

    if (compiledAllowed.length > 0) {
      const matchedAllowed = compiledAllowed.some((matcher) => matcher.test(text));

      if (!matchedAllowed) {
        return { allowed: false, detail: options.reason ?? defaultReason };
      }
    }

    return { allowed: true, detail: "" };
  };

  const input: InputGuardrail[] = [];
  const output: OutputGuardrail[] = [];

  if (boundary === "input" || boundary === "both") {
    input.push(
      defineInputGuardrail({
        id: `${id}.input`,
        check(context) {
          const verdict = checkText(context.inputText);
          return verdict.allowed ? allow() : block({ reason: verdict.detail, message });
        },
      }),
    );
  }

  if (boundary === "output" || boundary === "both") {
    output.push(
      defineOutputGuardrail({
        id: `${id}.output`,
        check(context) {
          const verdict = checkText(context.outputText);
          return verdict.allowed ? allow() : block({ reason: verdict.detail, message });
        },
      }),
    );
  }

  return defineGuardrailPolicy({
    id,
    mode,
    input,
    output,
  });
}

function validateTopic(topic: TopicMatcher): void {
  if (typeof topic === "string" && topic.trim().length === 0) {
    throw new TypeError("topicGuardrail topic strings must not be empty.");
  }
}

function describeTopic(topic: TopicMatcher): string {
  return typeof topic === "string" ? topic.trim() : topic.source;
}

function compileTopicMatcher(topic: TopicMatcher): {
  label: string;
  test(text: string): boolean;
} {
  if (typeof topic === "string") {
    const trimmed = topic.trim();
    const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");

    const pattern = CJK_ONLY_PATTERN.test(trimmed)
      ? escaped
      : `(?<![\\p{L}\\p{N}_])${escaped}(?![\\p{L}\\p{N}_])`;
    const regex = new RegExp(pattern, "iu");
    return {
      label: trimmed,
      test(text: string) {
        return regex.test(text);
      },
    };
  }

  const safeFlags = topic.flags.replace(/[gy]/g, "");
  const regex = new RegExp(topic.source, safeFlags);
  return {
    label: topic.source,
    test(text: string) {
      return regex.test(text);
    },
  };
}
