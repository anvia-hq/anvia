import { isPlainObject } from "@anvia/core/internal/provider";

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
