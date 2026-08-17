import type { JsonValue } from "@anvia/core/completion";
import type { ResolvedLensConfig } from "./config.js";
import type {
  LensDataset,
  LensDatasetClient,
  LensDatasetClientOptions,
  LensDatasetGetOptions,
  LensDatasetItem,
} from "./types.js";

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGINATION_PAGES = 100;

export class LensDatasetError extends Error {
  constructor(
    message: string,
    readonly status: number | undefined,
    readonly code: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "LensDatasetError";
  }
}

export function createLensDatasetClient(
  tracingConfig: ResolvedLensConfig,
  options: LensDatasetClientOptions = {},
): LensDatasetClient {
  const baseUrl = (options.baseUrl ?? tracingConfig.baseUrl).replace(/\/+$/, "");
  const publicKey = options.publicKey ?? tracingConfig.publicKey;
  const secretKey = options.secretKey ?? tracingConfig.secretKey;
  const timeoutMs = options.timeoutMs ?? tracingConfig.timeoutMs;
  const pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE;
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) {
    throw new TypeError("Anvia Lens dataset pageSize must be an integer between 1 and 100");
  }
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new TypeError("Anvia Lens dataset timeoutMs must be a positive number");
  }
  const authorization = `Basic ${Buffer.from(`${publicKey}:${secretKey}`).toString("base64")}`;

  return {
    async getDataset<Input = unknown, Expected = unknown>(getOptions: LensDatasetGetOptions) {
      const { name } = getOptions;
      const normalizedName = name.trim();
      if (normalizedName.length === 0) throw new TypeError("Anvia Lens dataset name is required");
      const items: LensDatasetItem<Input, Expected>[] = [];
      let dataset: Omit<LensDataset<Input, Expected>, "items"> | undefined;
      let totalPages: number | undefined;
      for (let page = 1; page <= MAX_PAGINATION_PAGES; page += 1) {
        const url = new URL(`${baseUrl}/api/public/datasets/${encodeURIComponent(normalizedName)}`);
        url.searchParams.set("page", String(page));
        url.searchParams.set("limit", String(pageSize));
        if (getOptions.version !== undefined) url.searchParams.set("version", getOptions.version);
        const response = await request(url, authorization, timeoutMs);
        const parsed = await parseDatasetResponse<Input, Expected>(response);
        const nextDataset: Omit<LensDataset<Input, Expected>, "items"> = {
          name: parsed.name,
          version: parsed.version,
        };
        if (parsed.description !== undefined) nextDataset.description = parsed.description;
        if (parsed.metadata !== undefined) nextDataset.metadata = parsed.metadata;
        dataset ??= nextDataset;
        if (dataset.name !== parsed.name || dataset.version !== parsed.version) {
          throw new LensDatasetError(
            "Lens returned inconsistent dataset pages",
            response.status,
            "invalid_response",
          );
        }
        if (totalPages === undefined) {
          totalPages = parsed.totalPages;
        } else if (totalPages !== parsed.totalPages) {
          throw new LensDatasetError(
            "Lens returned inconsistent dataset pagination",
            response.status,
            "invalid_response",
          );
        }
        items.push(...parsed.items);
        if (page >= totalPages) break;
        if (page === MAX_PAGINATION_PAGES) {
          throw new LensDatasetError(
            "Lens dataset exceeds the pagination limit",
            response.status,
            "pagination_limit",
          );
        }
      }
      if (dataset === undefined) {
        throw new LensDatasetError("Lens returned no dataset pages", undefined, "invalid_response");
      }
      return { ...dataset, items };
    },
  };
}

async function request(url: URL, authorization: string, timeoutMs: number): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json", Authorization: authorization },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (cause) {
    throw new LensDatasetError("Unable to reach Anvia Lens", undefined, "network_error", { cause });
  }
  if (!response.ok) {
    const error = await readApiError(response);
    throw new LensDatasetError(error.message, response.status, error.code);
  }
  return response;
}

function parseDatasetResponse<Input, Expected>(
  response: Response,
): Promise<{
  name: string;
  version: string;
  description?: string | undefined;
  metadata?: Record<string, JsonValue | undefined> | undefined;
  items: LensDatasetItem<Input, Expected>[];
  totalPages: number;
}> {
  return response
    .json()
    .catch((cause) => {
      throw new LensDatasetError(
        "Lens returned invalid JSON",
        response.status,
        "invalid_response",
        {
          cause,
        },
      );
    })
    .then((value: unknown) => {
      if (!isRecord(value) || typeof value.name !== "string" || typeof value.version !== "string") {
        throw invalidResponse(response, "Lens returned an invalid dataset");
      }
      if (!Array.isArray(value.items) || !isRecord(value.meta)) {
        throw invalidResponse(response, "Lens returned invalid dataset pagination");
      }
      const totalPages = value.meta.totalPages;
      if (!Number.isInteger(totalPages) || (totalPages as number) < 0) {
        throw invalidResponse(response, "Lens returned invalid dataset pagination");
      }
      const items = value.items.map((item) => parseItem<Input, Expected>(item, response));
      const result: {
        name: string;
        version: string;
        description?: string;
        metadata?: Record<string, JsonValue | undefined>;
        items: LensDatasetItem<Input, Expected>[];
        totalPages: number;
      } = { name: value.name, version: value.version, items, totalPages: totalPages as number };
      if (value.description !== undefined) {
        if (typeof value.description !== "string") {
          throw invalidResponse(response, "Lens returned an invalid dataset description");
        }
        result.description = value.description;
      }
      if (value.metadata !== undefined) {
        if (!isJsonRecord(value.metadata)) {
          throw invalidResponse(response, "Lens returned invalid dataset metadata");
        }
        result.metadata = value.metadata;
      }
      return result;
    });
}

function parseItem<Input, Expected>(
  value: unknown,
  response: Response,
): LensDatasetItem<Input, Expected> {
  if (!isRecord(value) || typeof value.id !== "string" || !("input" in value)) {
    throw invalidResponse(response, "Lens returned an invalid dataset item");
  }
  if (!isJsonValue(value.input)) {
    throw invalidResponse(response, "Lens returned a non-JSON dataset input");
  }
  const item: LensDatasetItem<Input, Expected> = { id: value.id, input: value.input as Input };
  if (value.expected !== undefined) {
    if (!isJsonValue(value.expected)) {
      throw invalidResponse(response, "Lens returned a non-JSON expected value");
    }
    item.expected = value.expected as Expected;
  }
  if (value.context !== undefined) item.context = stringArray(value.context, response, "context");
  if (value.retrievalContext !== undefined) {
    item.retrievalContext = stringArray(value.retrievalContext, response, "retrieval context");
  }
  if (value.metadata !== undefined) {
    if (!isJsonRecord(value.metadata)) {
      throw invalidResponse(response, "Lens returned invalid case metadata");
    }
    item.metadata = value.metadata;
  }
  return item;
}

async function readApiError(response: Response): Promise<{ code: string; message: string }> {
  try {
    const value: unknown = await response.json();
    if (isRecord(value) && isRecord(value.error)) {
      return {
        code: typeof value.error.code === "string" ? value.error.code : "request_failed",
        message:
          typeof value.error.message === "string"
            ? value.error.message
            : `Lens request failed (${response.status})`,
      };
    }
  } catch {
    // Fall through to a stable error when the server did not return JSON.
  }
  return { code: "request_failed", message: `Lens request failed (${response.status})` };
}

function invalidResponse(response: Response, message: string): LensDatasetError {
  return new LensDatasetError(message, response.status, "invalid_response");
}

function stringArray(value: unknown, response: Response, label: string): string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    throw invalidResponse(response, `Lens returned invalid ${label}`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isJsonRecord(value: unknown): value is Record<string, JsonValue> {
  return isRecord(value) && Object.values(value).every(isJsonValue);
}

function isJsonValue(value: unknown): value is JsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  ) {
    return true;
  }
  if (Array.isArray(value)) return value.every(isJsonValue);
  return isJsonRecord(value);
}
