import type { Message } from "@anvia/core/completion";
import { type AgentMiddleware, createMiddleware } from "@anvia/core/tool";

export type HistoryWindowOptions = {
  /** Maximum number of non-system messages to retain in `chatHistory` (the most recent turn is always preserved). */
  maxMessages?: number | undefined;
  /** Maximum approximate character budget across retained non-system messages (the most recent turn is always preserved). */
  maxChars?: number | undefined;
  /** Keep leading system messages outside the sliding window. Default true. */
  preserveSystemMessages?: boolean | undefined;
};

export function historyWindow(options: HistoryWindowOptions): AgentMiddleware {
  if (options.maxMessages === undefined && options.maxChars === undefined) {
    throw new TypeError("historyWindow requires at least one of maxMessages or maxChars.");
  }

  if (
    options.maxMessages !== undefined &&
    (!Number.isSafeInteger(options.maxMessages) || options.maxMessages <= 0)
  ) {
    throw new RangeError("historyWindow maxMessages must be a positive safe integer.");
  }

  if (
    options.maxChars !== undefined &&
    (!Number.isSafeInteger(options.maxChars) || options.maxChars <= 0)
  ) {
    throw new RangeError("historyWindow maxChars must be a positive safe integer.");
  }

  const preserveSystem = options.preserveSystemMessages ?? true;

  return createMiddleware({
    onCompletionRequest(args) {
      const history = args.request.chatHistory;

      if (history.length === 0) return undefined;

      const leadingSystem: Message[] = [];
      let bodyStart = 0;

      if (preserveSystem) {
        while (bodyStart < history.length && history[bodyStart]!.role === "system") {
          leadingSystem.push(history[bodyStart]!);
          bodyStart += 1;
        }
      }

      const body = history.slice(bodyStart);

      if (body.length === 0) return undefined;

      const groups = groupUserTurnUnits(body);
      const selectedGroups: Message[][] = [];
      let totalMessages = 0;
      let totalChars = 0;

      for (let i = groups.length - 1; i >= 0; i -= 1) {
        const group = groups[i]!;
        const groupChars = estimateGroupChars(group);
        const isMostRecent = selectedGroups.length === 0;
        const exceedsMessages =
          options.maxMessages !== undefined && totalMessages + group.length > options.maxMessages;
        const exceedsChars =
          options.maxChars !== undefined && totalChars + groupChars > options.maxChars;

        if (!isMostRecent && (exceedsMessages || exceedsChars)) {
          break;
        }

        selectedGroups.push(group);
        totalMessages += group.length;
        totalChars += groupChars;
      }

      selectedGroups.reverse();
      const retainedBody = dropLeadingOrphanedTools(selectedGroups.flat());
      const retained = [...leadingSystem, ...retainedBody];

      if (retained.length === history.length) {
        return undefined;
      }

      return {
        request: {
          ...args.request,
          chatHistory: retained,
        },
      };
    },
  });
}

function groupUserTurnUnits(messages: readonly Message[]): Message[][] {
  const units: Message[][] = [];
  let index = 0;

  while (index < messages.length) {
    const current = messages[index]!;

    if (current.role === "user") {
      const unit: Message[] = [current];
      index += 1;

      while (index < messages.length && messages[index]!.role !== "user") {
        unit.push(messages[index]!);
        index += 1;
      }

      units.push(unit);
      continue;
    }

    if (isAssistantWithToolCalls(current)) {
      const unit: Message[] = [current];
      index += 1;

      while (index < messages.length && messages[index]!.role === "tool") {
        unit.push(messages[index]!);
        index += 1;
      }

      units.push(unit);
      continue;
    }

    units.push([current]);
    index += 1;
  }

  return units;
}

function dropLeadingOrphanedTools(messages: readonly Message[]): Message[] {
  let start = 0;

  while (start < messages.length && messages[start]!.role === "tool") {
    start += 1;
  }

  return start === 0 ? [...messages] : messages.slice(start);
}

function isAssistantWithToolCalls(message: Message): boolean {
  if (message.role !== "assistant" || typeof message.content === "string") {
    return false;
  }

  return message.content.some((part) => part.type === "tool-call");
}

function estimateGroupChars(group: readonly Message[]): number {
  let total = 0;

  for (const message of group) {
    total += estimateMessageChars(message);
  }

  return total;
}

function estimateMessageChars(message: Message): number {
  if (typeof message.content === "string") {
    return message.content.length;
  }

  let total = 0;

  for (const part of message.content) {
    if (part.type === "text") {
      total += part.text.length;
    } else if (part.type === "reasoning") {
      total += part.text.length;

      if (part.details !== undefined) {
        for (const detail of part.details) {
          if (detail.type === "text" || detail.type === "summary") {
            total += detail.text.length;
          } else {
            total += 64;
          }
        }
      }
    } else if (part.type === "tool-call") {
      total += part.toolName.length + safeJsonLength(part.input);
    } else if (part.type === "tool-result") {
      total += part.toolName.length + estimateToolResultChars(part.output);
    } else if (part.type === "file") {
      total += part.data.type === "text" ? part.data.text.length : 128;
    } else {
      total += 64;
    }
  }

  return total;
}

function estimateToolResultChars(
  output: Extract<
    Extract<Message, { role: "tool" }>["content"][number],
    { type: "tool-result" }
  >["output"],
): number {
  if (output.type === "text" || output.type === "error-text") {
    return output.value.length;
  }

  if (output.type === "json" || output.type === "error-json") {
    return safeJsonLength(output.value);
  }

  if (output.type === "content") {
    let total = 0;

    for (const part of output.value) {
      if (part.type === "text") {
        total += part.text.length;
      } else if (part.type === "file" && part.data.type === "text") {
        total += part.data.text.length;
      } else {
        total += 128;
      }
    }

    return total;
  }

  if (output.type === "execution-denied") {
    return output.reason?.length ?? 32;
  }

  return 32;
}

function safeJsonLength(value: unknown): number {
  try {
    return JSON.stringify(value)?.length ?? 0;
  } catch {
    return 64;
  }
}
