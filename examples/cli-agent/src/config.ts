export const DEFAULT_MODEL = "deepseek/deepseek-v4-pro";
export const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

export function getModelName() {
  return process.env.ANVIA_MODEL ?? DEFAULT_MODEL;
}

export function getOpenRouterApiKey() {
  const apiKey = process.env.OPENROUTER_API_KEY;
  return apiKey !== undefined && apiKey.length > 0 ? apiKey : undefined;
}

export function getTavilyApiKey() {
  const apiKey = process.env.TAVILY_API_KEY;
  if (apiKey === undefined || apiKey.length === 0) {
    throw new Error("Set TAVILY_API_KEY before running the CLI.");
  }

  return apiKey;
}
