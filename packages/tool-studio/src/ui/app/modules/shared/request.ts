import { responseErrorMessage } from "../../app-errors";

export async function requestJson<T>(
  url: string,
  label: string,
  signal?: AbortSignal,
  cache: RequestCache = "default",
  init: RequestInit = {},
): Promise<T> {
  const response = await fetch(url, {
    ...init,
    cache,
    ...(signal === undefined ? {} : { signal }),
  });
  if (!response.ok) {
    throw new Error(await responseErrorMessage(response, label));
  }
  return (await response.json()) as T;
}
