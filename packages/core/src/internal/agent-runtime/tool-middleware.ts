import type { ToolResultContentPart } from "../../completion";
import { isJsonValue } from "../../completion";
import type { ToolHookArgs } from "../../hooks";
import type { NormalizedToolOutput } from "../../tool";
import { normalizeToolResultOutput, ToolOutput, toolResultContentToText } from "../../tool";
import type {
  AgentMiddleware,
  ToolOutputMiddlewareArgs,
  ToolOutputMiddlewareResult,
} from "../../tool/middleware";

export function sanitizeToolErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`;
  }

  if (typeof error === "string") {
    return error;
  }

  if (isJsonValue(error)) {
    return JSON.stringify(error);
  }

  return String(error);
}

export function toolOutputToText(output: NormalizedToolOutput): string {
  switch (output.type) {
    case "text":
    case "error-text":
      return output.value;
    case "json":
    case "error-json":
      return JSON.stringify(output.value);
    case "content":
      return toolResultContentToText(output.value);
    case "execution-denied":
      return output.reason ?? "Tool execution was denied.";
  }
}

export function toolOutputToStructuredResult(
  output: NormalizedToolOutput,
): readonly ToolResultContentPart[] | undefined {
  return output.type === "content" ? output.value : undefined;
}

export async function runToolInputMiddlewares(
  middlewares: readonly AgentMiddleware[],
  args: ToolHookArgs & { turn: number; originalArgs: string },
): Promise<string> {
  let current = args.args;
  for (const middleware of middlewares) {
    const replacement = await middleware.onToolInput?.({
      ...args,
      args: current,
    });

    if (replacement?.args !== undefined) {
      if (typeof replacement.args === "string") {
        current = replacement.args;
      } else {
        if (!isJsonValue(replacement.args)) {
          throw new TypeError("Tool input middleware args must be a strict JSON value.");
        }

        current = JSON.stringify(replacement.args);
      }
    }
  }
  return current;
}

export async function runToolResultMiddlewares(
  middlewares: readonly AgentMiddleware[],
  args: ToolOutputMiddlewareArgs,
): Promise<NormalizedToolOutput | undefined> {
  let result = args.result;
  let structuredResult = args.structuredResult;
  let replaced = false;
  for (const middleware of middlewares) {
    const outputReplacement = await middleware.onToolOutput?.({
      ...args,
      result,
      structuredResult,
    });

    if (outputReplacement !== undefined) {
      const normalized = normalizeToolOutputMiddlewareResult(outputReplacement);

      if (normalized.result !== undefined) {
        result = normalized.result;
        structuredResult = undefined;
      }

      if (normalized.structuredResult !== undefined) {
        structuredResult = normalized.structuredResult;
        result = toolResultContentToText(normalized.structuredResult);
      }

      replaced = true;
    }
  }

  if (!replaced) {
    return undefined;
  }

  return structuredResult === undefined
    ? { type: "text", value: result }
    : { type: "content", value: structuredResult };
}

function normalizeToolOutputMiddlewareResult(result: ToolOutputMiddlewareResult): {
  result?: string | undefined;
  structuredResult?: readonly ToolResultContentPart[] | undefined;
} {
  if (typeof result === "string") {
    return { result };
  }

  if (typeof result !== "object" || result === null) {
    throw new TypeError("Tool output middleware must return text or structured content.");
  }

  const prototype = Object.getPrototypeOf(result);

  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError("Tool output middleware must return text or structured content.");
  }

  const keys = Reflect.ownKeys(result);
  const hasResult = keys.includes("result");
  const hasStructuredResult = keys.includes("structuredResult");

  if (
    hasResult === hasStructuredResult ||
    keys.some((key) => key !== "result" && key !== "structuredResult")
  ) {
    throw new TypeError(
      "Tool output middleware must return exactly one of result or structuredResult.",
    );
  }

  if (hasResult) {
    const descriptor = Object.getOwnPropertyDescriptor(result, "result");

    if (
      descriptor === undefined ||
      !("value" in descriptor) ||
      typeof descriptor.value !== "string"
    ) {
      throw new TypeError("Tool output middleware result must be a string.");
    }

    return { result: descriptor.value };
  }

  const descriptor = Object.getOwnPropertyDescriptor(result, "structuredResult");

  if (descriptor === undefined || !("value" in descriptor)) {
    throw new TypeError("Tool output middleware structuredResult must be valid tool content.");
  }

  const normalized = normalizeToolResultOutput(ToolOutput.content(descriptor.value as never));

  if (normalized.type !== "content") {
    throw new TypeError("Tool output middleware structuredResult must be valid tool content.");
  }

  return { structuredResult: normalized.value };
}
