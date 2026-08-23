export type GrokHttpOptions = {
  apiKey: string;
  baseUrl: string;
  headers?: Record<string, string> | undefined;
  fetch?: typeof fetch | undefined;
};

export function grokFetch(options: GrokHttpOptions): typeof fetch {
  if (options.fetch !== undefined) {
    return options.fetch;
  }
  if (typeof globalThis.fetch === "function") {
    return globalThis.fetch.bind(globalThis);
  }
  throw new Error("Grok media requests require a fetch implementation.");
}

export function grokEndpoint(options: GrokHttpOptions, path: string): string {
  return `${options.baseUrl.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

export function grokHeaders(
  options: GrokHttpOptions,
  additional: Record<string, string> = {},
): Record<string, string> {
  if (options.apiKey === undefined || options.apiKey.length === 0) {
    throw new Error("Missing Grok credentials for media request.");
  }
  return {
    ...options.headers,
    ...additional,
    Authorization: `Bearer ${options.apiKey}`,
  };
}

export async function throwGrokHttpError(response: Response, operation: string): Promise<never> {
  const detail = (await response.text()).trim();
  const suffix = detail.length === 0 ? "" : `: ${detail.slice(0, 500)}`;
  throw new Error(`Grok ${operation} failed with status ${response.status.toString()}${suffix}`);
}
