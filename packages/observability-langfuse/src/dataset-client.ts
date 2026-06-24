import type { JsonValue } from "@anvia/core/completion";
import { resolveOption } from "./helpers.js";
import { LangfuseScoreError } from "./scoring.js";
import type {
  LangfuseDataset,
  LangfuseDatasetClient,
  LangfuseDatasetClientOptions,
  LangfuseDatasetItem,
  LangfuseRunExperimentOptions,
  LangfuseRunExperimentResult,
  LangfuseRunItemError,
  LangfuseTracing,
} from "./types.js";

const DEFAULT_PAGE_SIZE = 50;
const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_PAGINATION_PAGES = 100;

export function createLangfuseDatasetClient(
  _tracing: Pick<LangfuseTracing, "score">,
  options: LangfuseDatasetClientOptions = {},
): LangfuseDatasetClient {
  const baseUrl =
    resolveOption(options.baseUrl, process.env.LANGFUSE_BASE_URL) ?? "https://cloud.langfuse.com";
  const publicKey = resolveOption(options.publicKey, process.env.LANGFUSE_PUBLIC_KEY);
  const secretKey = resolveOption(options.secretKey, process.env.LANGFUSE_SECRET_KEY);
  const pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const fetchImpl: typeof fetch = (...args) =>
    fetch(args[0], { ...(args[1] ?? {}), signal: AbortSignal.timeout(timeoutMs) });

  const authHeader = buildAuthHeader(publicKey, secretKey);

  async function request<T>(input: string, init: RequestInit): Promise<T> {
    const response = await fetchImpl(input, {
      ...init,
      headers: {
        ...(init.headers ?? {}),
        ...authHeader,
        "Content-Type": "application/json",
      },
    });
    if (!response.ok) {
      const body = await readErrorBody(response);
      throw new LangfuseScoreError(
        `Langfuse request failed: ${response.status} ${response.statusText}: ${body}`,
        [],
      );
    }
    if (response.status === 204) {
      return undefined as T;
    }
    return (await response.json()) as T;
  }

  return {
    async createDataset(dataset) {
      const url = `${baseUrl}/api/public/datasets/${encodeURIComponent(dataset.name)}`;
      await request<unknown>(url, {
        method: "PUT",
        body: JSON.stringify({
          name: dataset.name,
          description: dataset.description,
          metadata: dataset.metadata,
        }),
      });
      return {
        name: dataset.name,
        ...(dataset.description === undefined ? {} : { description: dataset.description }),
        ...(dataset.metadata === undefined ? {} : { metadata: dataset.metadata }),
        items: [],
      };
    },

    async getDataset<Input, Expected>(name: string): Promise<LangfuseDataset<Input, Expected>> {
      const items: LangfuseDatasetItem<Input, Expected>[] = [];
      let description: string | undefined;
      let metadata: Record<string, JsonValue | undefined> | undefined;
      for (let page = 1; page <= MAX_PAGINATION_PAGES; page += 1) {
        const url = new URL(`${baseUrl}/api/public/datasets/${encodeURIComponent(name)}`);
        url.searchParams.set("page", String(page));
        url.searchParams.set("limit", String(pageSize));
        const response = await request<{
          name: string;
          description?: string | undefined;
          metadata?: Record<string, JsonValue | undefined> | undefined;
          items: Array<{
            id: string;
            input: Input;
            expected?: Expected | undefined;
            metadata?: Record<string, JsonValue | undefined> | undefined;
          }>;
          meta?: { totalPages?: number | undefined };
        }>(url.toString(), { method: "GET" });
        if (description === undefined && response.description !== undefined) {
          description = response.description;
        }
        if (metadata === undefined && response.metadata !== undefined) {
          metadata = response.metadata;
        }
        for (const item of response.items) {
          items.push({
            id: item.id,
            input: item.input,
            ...(item.expected === undefined ? {} : { expected: item.expected }),
            ...(item.metadata === undefined ? {} : { metadata: item.metadata }),
          });
        }
        const totalPages = response.meta?.totalPages;
        if (totalPages !== undefined && page >= totalPages) {
          break;
        }
        if (totalPages === undefined && response.items.length < pageSize) {
          break;
        }
      }
      const dataset: LangfuseDataset<Input, Expected> = {
        name,
        items,
      };
      if (description !== undefined) dataset.description = description;
      if (metadata !== undefined) dataset.metadata = metadata;
      return dataset;
    },

    async upsertItems<Input, Expected>(
      name: string,
      items: LangfuseDatasetItem<Input, Expected>[],
    ): Promise<void> {
      const url = `${baseUrl}/api/public/datasets/${encodeURIComponent(name)}/items`;
      await request<unknown>(url, {
        method: "POST",
        body: JSON.stringify({ items }),
      });
    },

    async runExperiment<Input, Output, Expected>(
      opts: LangfuseRunExperimentOptions<Input, Output, Expected>,
    ): Promise<LangfuseRunExperimentResult> {
      let items = opts.items;
      if (items === undefined) {
        const dataset = await this.getDataset<Input, Expected>(opts.datasetName);
        items = dataset.items;
      }
      if (items === undefined || items.length === 0) {
        return {
          runName: opts.runName,
          datasetName: opts.datasetName,
          posted: 0,
          errors: [],
        };
      }
      const datasetItemRuns: Array<{
        datasetItemId: string;
        traceId?: string;
        observationId?: string;
        output: JsonValue;
      }> = [];
      const errors: LangfuseRunItemError[] = [];
      for (const item of items) {
        try {
          const result = await opts.run(item);
          datasetItemRuns.push({
            datasetItemId: item.id,
            ...(result.trace?.traceId === undefined ? {} : { traceId: result.trace.traceId }),
            ...(result.trace?.observationId === undefined
              ? {}
              : { observationId: result.trace.observationId }),
            output: toJsonValue(result.output),
          });
        } catch (error) {
          errors.push({ itemId: item.id, error });
        }
      }
      const url = `${baseUrl}/api/public/dataset-run-items`;
      const body: Record<string, unknown> = {
        runName: opts.runName,
        datasetItemRuns,
      };
      if (opts.description !== undefined) body.runDescription = opts.description;
      if (opts.metadata !== undefined) body.metadata = opts.metadata;
      await request<unknown>(url, {
        method: "POST",
        body: JSON.stringify(body),
      });
      return {
        runName: opts.runName,
        datasetName: opts.datasetName,
        posted: datasetItemRuns.length,
        errors,
      };
    },
  };
}

function buildAuthHeader(
  publicKey: string | undefined,
  secretKey: string | undefined,
): Record<string, string> {
  if (publicKey === undefined || secretKey === undefined) {
    return {};
  }
  const encoded = Buffer.from(`${publicKey}:${secretKey}`).toString("base64");
  return { Authorization: `Basic ${encoded}` };
}

async function readErrorBody(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return "<unreadable>";
  }
}

function toJsonValue(value: unknown): JsonValue {
  if (value === null) return null;
  if (typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return value;
  try {
    return JSON.parse(JSON.stringify(value)) as JsonValue;
  } catch {
    return String(value);
  }
}
