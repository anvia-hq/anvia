import OpenAI from "openai";

type AzureOpenAIEndpointOptions =
  | { endpoint: string; baseUrl?: never }
  | { baseUrl: string; endpoint?: never };

type AzureOpenAICredentials =
  | { apiKey: string; azureADTokenProvider?: never }
  | { azureADTokenProvider: () => Promise<string>; apiKey?: never };

type AzureOpenAIManagedClientOptions = AzureOpenAIEndpointOptions &
  AzureOpenAICredentials & {
    headers?: Record<string, string> | undefined;
    fetch?: typeof fetch | undefined;
    client?: never;
  };

type AzureOpenAIInjectedClientOptions = {
  client: OpenAI;
  endpoint?: never;
  baseUrl?: never;
  apiKey?: never;
  azureADTokenProvider?: never;
  headers?: never;
  fetch?: never;
};

export type AzureOpenAIClientOptions =
  | AzureOpenAIManagedClientOptions
  | AzureOpenAIInjectedClientOptions;

export function createAzureOpenAISdk(options: AzureOpenAIClientOptions): OpenAI {
  if (options.client !== undefined) {
    const conflict = [
      "endpoint",
      "baseUrl",
      "apiKey",
      "azureADTokenProvider",
      "headers",
      "fetch",
    ].find((key) => key in options);
    if (conflict !== undefined) {
      throw new TypeError(`AzureOpenAIClient cannot combine client with ${conflict}.`);
    }
    return options.client;
  }

  if ((options.endpoint !== undefined) === (options.baseUrl !== undefined)) {
    throw new TypeError("AzureOpenAIClient requires exactly one of endpoint or baseUrl.");
  }
  if ((options.apiKey !== undefined) === (options.azureADTokenProvider !== undefined)) {
    throw new TypeError(
      "AzureOpenAIClient requires exactly one of apiKey or azureADTokenProvider.",
    );
  }
  if (
    options.apiKey !== undefined &&
    (typeof options.apiKey !== "string" || options.apiKey.trim().length === 0)
  ) {
    throw new TypeError("AzureOpenAIClient apiKey must be a non-empty string.");
  }
  if (
    options.azureADTokenProvider !== undefined &&
    typeof options.azureADTokenProvider !== "function"
  ) {
    throw new TypeError("AzureOpenAIClient azureADTokenProvider must be a function.");
  }

  const baseURL = resolveBaseUrl(options);
  const tokenProvider = options.azureADTokenProvider;
  const apiKey =
    tokenProvider === undefined
      ? options.apiKey
      : async () => {
          const token = await tokenProvider();
          if (typeof token !== "string" || token.trim().length === 0) {
            throw new TypeError("AzureOpenAIClient token provider must return a non-empty string.");
          }
          return token;
        };

  return new OpenAI({
    apiKey,
    baseURL,
    defaultHeaders: options.headers,
    fetch: options.fetch,
    maxRetries: 0,
  });
}

function resolveBaseUrl(options: AzureOpenAIEndpointOptions): string {
  const value = options.endpoint ?? options.baseUrl;
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError("AzureOpenAIClient endpoint or baseUrl must be a non-empty URL.");
  }
  const url = new URL(value);
  if (
    !["https:", "http:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new TypeError(
      "AzureOpenAIClient requires an HTTP(S) URL without credentials, query, or fragment.",
    );
  }
  if (options.endpoint !== undefined) {
    if (url.pathname !== "/") {
      throw new TypeError(
        "AzureOpenAIClient endpoint must be a resource origin. Use baseUrl for a full API URL.",
      );
    }
    url.pathname = "/openai/v1/";
  } else {
    url.pathname = `${url.pathname.replace(/\/+$/, "")}/`;
  }
  return url.toString();
}
