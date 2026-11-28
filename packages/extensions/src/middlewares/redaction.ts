import type {
  AssistantContentPart,
  Document,
  FilePart,
  Message,
  ToolResultContentPart,
  ToolResultOutput,
  UserContentPart,
} from "@anvia/core/completion";
import {
  createRedactor,
  DEFAULT_PATTERNS,
  type RedactionPattern,
  type Redactor,
} from "@anvia/core/redaction";
import { type AgentMiddleware, createMiddleware } from "@anvia/core/tool";
import { compilePatterns, redactStringWithCompiledPatterns } from "../internal/pattern-redaction";

type RedactorSourceOptions =
  | {
      redactor: Redactor;
      patterns?: never;
      replacement?: never;
    }
  | {
      redactor?: never;
      patterns?: readonly RedactionPattern[] | undefined;
      replacement?: string | undefined;
    };

export type RedactToolOutputOptions = RedactorSourceOptions & {
  /** Optional allowlist of tool names to redact. Applies to all tools when omitted. */
  tools?: readonly string[] | undefined;
};

export type RedactCompletionRequestOptions = RedactorSourceOptions;

export function redactToolOutput(options: RedactToolOutputOptions = {}): AgentMiddleware {
  const redactor = resolveRedactor(options);
  const toolSet = options.tools === undefined ? undefined : new Set(options.tools);

  return createMiddleware({
    onToolOutput(args) {
      if (toolSet !== undefined && !toolSet.has(args.toolName)) {
        return undefined;
      }

      if (args.structuredResult !== undefined) {
        let changed = false;
        const nextParts: ToolResultContentPart[] = args.structuredResult.map((part) => {
          const next = redactToolResultContentPart(part, redactor);

          if (next !== part) changed = true;

          return next;
        });

        return changed ? { structuredResult: nextParts } : undefined;
      }

      const redacted = redactor.redactString(args.result);
      return redacted === args.result ? undefined : { result: redacted };
    },
  });
}

export function redactCompletionRequest(
  options: RedactCompletionRequestOptions = {},
): AgentMiddleware {
  const redactor = resolveRedactor(options);

  return createMiddleware({
    onCompletionRequest(args) {
      const redactedHistory = args.request.chatHistory.map((message) =>
        redactSafeMessage(message, redactor),
      );
      const redactedInstructions =
        args.request.instructions === undefined
          ? undefined
          : redactor.redactString(args.request.instructions);
      const redactedDocuments = args.request.documents.map((doc) => redactDocument(doc, redactor));

      const nextRequest = {
        ...args.request,
        chatHistory: redactedHistory,
        documents: redactedDocuments,
      };

      if (redactedInstructions !== undefined) {
        nextRequest.instructions = redactedInstructions;
      }

      return { request: nextRequest };
    },
  });
}

function redactSafeMessage(message: Message, redactor: Redactor): Message {
  if (message.role === "system") {
    return {
      ...message,
      content: redactor.redactString(message.content),
    };
  }

  if (message.role === "user") {
    if (typeof message.content === "string") {
      return {
        ...message,
        content: redactor.redactString(message.content),
      };
    }

    return {
      ...message,
      content: message.content.map((part) => redactUserPart(part, redactor)),
    };
  }

  if (message.role === "assistant") {
    if (typeof message.content === "string") {
      return {
        ...message,
        content: redactor.redactString(message.content),
      };
    }

    return {
      ...message,
      content: message.content.map((part) => redactAssistantPart(part, redactor)),
    };
  }

  return {
    ...message,
    content: message.content.map((part) => {
      if (part.type !== "tool-result") return part;

      return {
        ...part,
        output: redactToolResultOutput(part.output, redactor),
      };
    }),
  };
}

function redactUserPart(part: UserContentPart, redactor: Redactor): UserContentPart {
  if (part.type === "text") {
    const redacted = redactor.redactString(part.text);
    return redacted === part.text ? part : { ...part, text: redacted };
  }

  if (part.type === "file") {
    return redactFilePart(part, redactor);
  }

  return part;
}

function redactAssistantPart(part: AssistantContentPart, redactor: Redactor): AssistantContentPart {
  if (part.type === "text") {
    const redacted = redactor.redactString(part.text);
    return redacted === part.text ? part : { ...part, text: redacted };
  }

  if (part.type === "tool-call") {
    return {
      ...part,
      input: redactor.redact(part.input) as typeof part.input,
    };
  }

  if (part.type === "reasoning") {
    const redactedText = redactor.redactString(part.text);
    const redactedDetails = part.details?.map((detail) => {
      if (detail.type === "text" || detail.type === "summary") {
        const nextText = redactor.redactString(detail.text);
        return nextText === detail.text ? detail : { ...detail, text: nextText };
      }

      return detail;
    });

    const next = { ...part, text: redactedText };

    if (redactedDetails !== undefined) {
      next.details = redactedDetails;
    }

    return next;
  }

  return part;
}

function redactToolResultOutput(output: ToolResultOutput, redactor: Redactor): ToolResultOutput {
  if (output.type === "text" || output.type === "error-text") {
    const redacted = redactor.redactString(output.value);
    return redacted === output.value ? output : { ...output, value: redacted };
  }

  if (output.type === "json" || output.type === "error-json") {
    return { ...output, value: redactor.redact(output.value) as typeof output.value };
  }

  if (output.type === "content") {
    return {
      type: "content",
      value: output.value.map((part) => redactToolResultContentPart(part, redactor)),
    };
  }

  if (output.type === "execution-denied" && output.reason !== undefined) {
    const redacted = redactor.redactString(output.reason);
    return redacted === output.reason ? output : { ...output, reason: redacted };
  }

  return output;
}

function redactToolResultContentPart(
  part: ToolResultContentPart,
  redactor: Redactor,
): ToolResultContentPart {
  if (part.type === "text") {
    const redacted = redactor.redactString(part.text);
    return redacted === part.text ? part : { ...part, text: redacted };
  }

  return redactFilePart(part, redactor);
}

function redactFilePart(part: FilePart, redactor: Redactor): FilePart {
  let nextData = part.data;

  if (part.data.type === "text") {
    const redactedText = redactor.redactString(part.data.text);

    if (redactedText !== part.data.text) {
      nextData = { type: "text", text: redactedText };
    }
  }

  const nextFilename =
    part.filename === undefined ? undefined : redactor.redactString(part.filename);

  if (nextData === part.data && nextFilename === part.filename) {
    return part;
  }

  if (nextFilename !== undefined) {
    return { ...part, data: nextData, filename: nextFilename };
  }

  return { ...part, data: nextData };
}

function redactDocument(doc: Document, redactor: Redactor): Document {
  const nextDoc: Document = {
    ...doc,
    id: redactor.redactString(doc.id),
    text: redactor.redactString(doc.text),
  };

  if (doc.additionalProps !== undefined) {
    const redactedProps: Record<string, string> = {};
    for (const [key, value] of Object.entries(doc.additionalProps)) {
      redactedProps[key] = redactor.redactString(value);
    }
    nextDoc.additionalProps = redactedProps;
  }

  return nextDoc;
}

function resolveRedactor(options: {
  redactor?: Redactor | undefined;
  patterns?: readonly RedactionPattern[] | undefined;
  replacement?: string | undefined;
}): Redactor {
  if (options.redactor !== undefined) {
    if (options.patterns !== undefined || options.replacement !== undefined) {
      throw new TypeError(
        "Provide either a custom redactor or patterns/replacement options, not both.",
      );
    }

    return options.redactor;
  }

  const patterns = options.patterns ?? DEFAULT_PATTERNS;
  const replacement = options.replacement ?? "<redacted>";
  const compiled = compilePatterns(patterns);
  const base = createRedactor({ patterns: [...patterns], replacement });

  return {
    ...base,
    redactString(value: string): string {
      if (typeof value !== "string") return value;

      return redactStringWithCompiledPatterns(value, compiled, replacement);
    },
  };
}
