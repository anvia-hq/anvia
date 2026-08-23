export function defaultOutputValue(output: unknown): unknown {
  if (typeof output === "object" && output !== null && "output" in output) {
    return (output as { output: unknown }).output;
  }
  return output;
}

export function stableComparable(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  return JSON.stringify(value);
}

export function formatValue(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
