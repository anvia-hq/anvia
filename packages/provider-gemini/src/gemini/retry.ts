export function disableGeminiNativeRetries(
  config: Record<string, unknown>,
): Record<string, unknown> {
  const httpOptions = isPlainObject(config.httpOptions) ? config.httpOptions : {};
  const retryOptions = isPlainObject(httpOptions.retryOptions) ? httpOptions.retryOptions : {};
  return {
    ...config,
    httpOptions: {
      ...httpOptions,
      retryOptions: {
        ...retryOptions,
        attempts: 1,
      },
    },
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
