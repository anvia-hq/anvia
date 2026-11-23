import { z } from "zod";
import type { CompletionModel, Message } from "../../completion";
import { mapWithConcurrency } from "../../internal/concurrency";
import { addUsage, runJudge } from "../judge";
import { EvalOutcome } from "../outcome";
import type { EvalMetric, EvalMetricArgs, EvalTurn, ValueSelector } from "../types";
import {
  binaryVerdictSchema,
  factsSchema,
  higherOutcome,
  type IncludeReasonMode,
  jsonPrompt,
  maybeReason,
  metricConfig,
  numericMetric,
  validatePositiveInteger,
  willPassHigher,
} from "./shared";

type ConversationSource = EvalTurn[] | Message[];

type ConversationEvalOptions<Input, Output, Expected = unknown> = {
  name?: string | undefined;
  required?: boolean | undefined;
  model: CompletionModel;
  threshold?: number | undefined;
  strictMode?: boolean | undefined;
  includeReason?: IncludeReasonMode | undefined;
  retries?: number | undefined;
  concurrency?: number | undefined;
  turns?: ValueSelector<Input, Output, Expected, ConversationSource> | undefined;
};

export type TurnRelevancyOptions<Input, Output, Expected = unknown> = ConversationEvalOptions<
  Input,
  Output,
  Expected
> & {
  windowSize?: number | undefined;
};

export function turnRelevancy<
  Input,
  Output,
  Expected = unknown,
  const Name extends string = string,
>(
  options: TurnRelevancyOptions<Input, Output, Expected> & { name?: Name | undefined },
): EvalMetric<Input, Output, number, Expected, Name> {
  const config = metricConfig<Name>(options, "turn_relevancy");
  const windowSize = validatePositiveInteger(options.windowSize ?? 10, "windowSize");
  const concurrency = validatePositiveInteger(options.concurrency ?? 4, "concurrency");
  return numericMetric(config.name, config, "higher_is_better", async (args) => {
    try {
      const turns = await resolveTurns(options.turns, args);
      const interactions = unitInteractions(turns);
      const windows = interactions.map((_, index) =>
        interactions.slice(Math.max(0, index - windowSize + 1), index + 1).flat(),
      );
      const verdictResults = await mapWithConcurrency(windows, concurrency, (window) =>
        runJudge({
          model: options.model,
          schema: binaryVerdictSchema,
          instructions:
            "Judge whether the final assistant reply is relevant to the preceding conversation. Return yes for relevant and no for irrelevant, with a concise reason.",
          prompt: jsonPrompt({ turns: window }),
          abortSignal: args.signal,
          retries: config.retries,
        }),
      );
      const verdicts = verdictResults.map((result, index) => ({
        interaction: index + 1,
        ...result.data,
      }));
      const score =
        verdicts.length === 0
          ? 1
          : verdicts.filter((verdict) => verdict.verdict === "yes").length / verdicts.length;
      const reasonResult = await maybeReason({
        model: options.model,
        includeReason: config.includeReason,
        passed: willPassHigher(score, config.threshold, config.strictMode),
        retries: config.retries,
        metric: "turn relevancy",
        abortSignal: args.signal,
        score,
        evidence: { verdicts },
      });
      const usage = addUsage(...verdictResults.map((result) => result.usage), reasonResult.usage);
      return higherOutcome({
        score,
        threshold: config.threshold,
        strictMode: config.strictMode,
        comment: reasonResult.reason,
        details: { windowSize, concurrency, interactionCount: interactions.length, verdicts },
        usage,
      });
    } catch (error) {
      return EvalOutcome.fromError(error);
    }
  });
}

export type KnowledgeRetentionOptions<Input, Output, Expected = unknown> = ConversationEvalOptions<
  Input,
  Output,
  Expected
>;

export function knowledgeRetention<
  Input,
  Output,
  Expected = unknown,
  const Name extends string = string,
>(
  options: KnowledgeRetentionOptions<Input, Output, Expected> & { name?: Name | undefined },
): EvalMetric<Input, Output, number, Expected, Name> {
  const config = metricConfig<Name>(options, "knowledge_retention");
  const concurrency = validatePositiveInteger(options.concurrency ?? 4, "concurrency");
  return numericMetric(config.name, config, "higher_is_better", async (args) => {
    try {
      const turns = await resolveTurns(options.turns, args);
      const userTurns = turns
        .map((turn, index) => ({ turn, index }))
        .filter((entry) => entry.turn.role === "user");
      const knowledgeResults = await mapWithConcurrency(userTurns, concurrency, (entry) =>
        runJudge({
          model: options.model,
          schema: factsSchema,
          instructions:
            "Extract durable factual information newly supplied by the final user message. Use prior turns only to resolve references. Return concise facts; return an empty array when nothing new was supplied.",
          prompt: jsonPrompt({
            previousTurns: turns.slice(0, entry.index),
            userMessage: entry.turn.content,
          }),
          abortSignal: args.signal,
          retries: config.retries,
        }),
      );
      const knowledge = userTurns.map((entry, index) => ({
        turnIndex: entry.index,
        facts: knowledgeResults[index]?.data.facts ?? [],
      }));
      const assistantChecks = turns
        .map((turn, index) => ({ turn, index }))
        .filter((entry) => entry.turn.role === "assistant")
        .map((entry) => ({
          ...entry,
          facts: knowledge
            .filter((item) => item.turnIndex < entry.index)
            .flatMap((item) => item.facts),
        }))
        .filter((entry) => entry.facts.length > 0);
      const verdictResults = await mapWithConcurrency(assistantChecks, concurrency, (entry) =>
        runJudge({
          model: options.model,
          schema: z.object({ attrition: z.boolean(), reason: z.string() }),
          instructions:
            "Determine whether the assistant reply forgets, contradicts, or unnecessarily asks again for information already supplied by the user. Set attrition true only when knowledge was lost.",
          prompt: jsonPrompt({ knownFacts: entry.facts, assistantReply: entry.turn.content }),
          abortSignal: args.signal,
          retries: config.retries,
        }),
      );
      const verdicts = assistantChecks.map((entry, index) => ({
        turnIndex: entry.index,
        attrition: verdictResults[index]?.data.attrition ?? true,
        reason: verdictResults[index]?.data.reason ?? "Missing knowledge-retention verdict.",
      }));
      const score =
        verdicts.length === 0
          ? 1
          : verdicts.filter((verdict) => !verdict.attrition).length / verdicts.length;
      const reasonResult = await maybeReason({
        model: options.model,
        includeReason: config.includeReason,
        passed: willPassHigher(score, config.threshold, config.strictMode),
        retries: config.retries,
        metric: "knowledge retention",
        abortSignal: args.signal,
        score,
        evidence: { verdicts },
      });
      const usage = addUsage(
        ...knowledgeResults.map((result) => result.usage),
        ...verdictResults.map((result) => result.usage),
        reasonResult.usage,
      );
      return higherOutcome({
        score,
        threshold: config.threshold,
        strictMode: config.strictMode,
        comment: reasonResult.reason,
        details: { concurrency, knowledge, verdicts },
        usage,
      });
    } catch (error) {
      return EvalOutcome.fromError(error);
    }
  });
}

function normalizeEvalTurns(value: unknown): EvalTurn[] | undefined {
  const source = conversationArray(value);

  if (source === undefined) return undefined;

  const turns: EvalTurn[] = [];
  for (const entry of source) {
    if (typeof entry !== "object" || entry === null) continue;

    const role = (entry as { role?: unknown }).role;

    if (role !== "user" && role !== "assistant") continue;

    const content = (entry as { content?: unknown }).content;
    const text = contentText(content);

    if (text.length === 0) continue;

    const metadata = (entry as { metadata?: unknown }).metadata;
    turns.push(
      typeof metadata === "object" && metadata !== null && !Array.isArray(metadata)
        ? { role, content: text, metadata: metadata as EvalTurn["metadata"] }
        : { role, content: text },
    );
  }
  return turns.length === 0 ? undefined : turns;
}

async function resolveTurns<Input, Output, Expected>(
  selector: ValueSelector<Input, Output, Expected, ConversationSource> | undefined,
  args: EvalMetricArgs<Input, Output, Expected>,
): Promise<EvalTurn[]> {
  const source = selector === undefined ? args.output : await selector(args);
  const turns = normalizeEvalTurns(source);

  if (turns === undefined) {
    throw new TypeError(
      "Conversational eval requires non-empty EvalTurn[], Message[], or an output with messages.",
    );
  }

  return turns;
}

function unitInteractions(turns: EvalTurn[]): EvalTurn[][] {
  const interactions: EvalTurn[][] = [];
  let current: EvalTurn[] = [];
  let hasUser = false;
  for (const turn of turns) {
    if (current.at(-1)?.role === "assistant" && turn.role === "user" && hasUser) {
      interactions.push(current);
      current = [turn];
      hasUser = true;
      continue;
    }

    current.push(turn);

    if (turn.role === "user") hasUser = true;
  }

  if (current.length > 1 && current.at(-1)?.role === "assistant" && hasUser) {
    interactions.push(current);
  }

  return interactions;
}

function conversationArray(value: unknown): unknown[] | undefined {
  if (Array.isArray(value)) return value;

  if (typeof value === "object" && value !== null && "messages" in value) {
    const messages = (value as { messages?: unknown }).messages;
    return Array.isArray(messages) ? messages : undefined;
  }

  return undefined;
}

function contentText(content: unknown): string {
  if (typeof content === "string") return content;

  if (!Array.isArray(content)) return "";

  return content
    .flatMap((part) =>
      typeof part === "object" &&
      part !== null &&
      "type" in part &&
      part.type === "text" &&
      "text" in part &&
      typeof part.text === "string"
        ? [part.text]
        : [],
    )
    .join("\n");
}
