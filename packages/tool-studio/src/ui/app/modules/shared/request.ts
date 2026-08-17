import { responseErrorMessage } from "../../app-errors";

export async function requestJson<T>(
  url: string,
  label: string,
  signal?: AbortSignal,
  cache: RequestCache = "default",
  init: RequestInit = {},
): Promise<T> {
  const request: RequestInit = {
    ...init,
    cache,
  };
  if (signal !== undefined) request.signal = signal;
  const response = await fetch(url, request);
  if (!response.ok) {
    throw new Error(await responseErrorMessage(response, label));
  }
  return (await response.json()) as T;
}
