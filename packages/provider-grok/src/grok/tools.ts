import type { JsonObject, ProviderTool } from "@anvia/core/completion";

export type GrokWebSearchOptions = {
  allowedDomains?: string[] | undefined;
  excludedDomains?: string[] | undefined;
  enableImageUnderstanding?: boolean | undefined;
  enableImageSearch?: boolean | undefined;
};

export type GrokXSearchOptions = {
  allowedHandles?: string[] | undefined;
  excludedHandles?: string[] | undefined;
  fromDate?: string | undefined;
  toDate?: string | undefined;
  enableImageUnderstanding?: boolean | undefined;
  enableVideoUnderstanding?: boolean | undefined;
};

export type GrokFileSearchOptions = {
  vectorStoreIds: string[];
  maxNumResults?: number | undefined;
};

export type GrokMcpOptions = {
  serverUrl: string;
  serverLabel: string;
  serverDescription?: string | undefined;
  allowedTools?: string[] | undefined;
  authorization?: string | undefined;
  headers?: Record<string, string> | undefined;
};

export type GrokProviderTool = ProviderTool & {
  provider: "grok";
};

export function webSearch(options: GrokWebSearchOptions = {}): GrokProviderTool {
  validateExclusive(
    options.allowedDomains,
    options.excludedDomains,
    "allowedDomains",
    "excludedDomains",
  );
  const allowedDomains = validateStringList(options.allowedDomains, "allowedDomains", 5);
  const excludedDomains = validateStringList(options.excludedDomains, "excludedDomains", 5);
  const filters: JsonObject = {};
  if (allowedDomains !== undefined) filters.allowed_domains = allowedDomains;
  if (excludedDomains !== undefined) filters.excluded_domains = excludedDomains;

  return grokProviderTool("web_search", {
    ...(Object.keys(filters).length === 0 ? {} : { filters }),
    ...(options.enableImageUnderstanding === undefined
      ? {}
      : { enable_image_understanding: options.enableImageUnderstanding }),
    ...(options.enableImageSearch === undefined
      ? {}
      : { enable_image_search: options.enableImageSearch }),
  });
}

export function xSearch(options: GrokXSearchOptions = {}): GrokProviderTool {
  validateExclusive(
    options.allowedHandles,
    options.excludedHandles,
    "allowedHandles",
    "excludedHandles",
  );
  const allowedHandles = validateStringList(options.allowedHandles, "allowedHandles", 20);
  const excludedHandles = validateStringList(options.excludedHandles, "excludedHandles", 20);
  const fromDate = validateDate(options.fromDate, "fromDate");
  const toDate = validateDate(options.toDate, "toDate");
  if (fromDate !== undefined && toDate !== undefined && fromDate > toDate) {
    throw new TypeError("Grok X Search fromDate must not be after toDate.");
  }

  return grokProviderTool("x_search", {
    ...(allowedHandles === undefined ? {} : { allowed_x_handles: allowedHandles }),
    ...(excludedHandles === undefined ? {} : { excluded_x_handles: excludedHandles }),
    ...(fromDate === undefined ? {} : { from_date: fromDate }),
    ...(toDate === undefined ? {} : { to_date: toDate }),
    ...(options.enableImageUnderstanding === undefined
      ? {}
      : { enable_image_understanding: options.enableImageUnderstanding }),
    ...(options.enableVideoUnderstanding === undefined
      ? {}
      : { enable_video_understanding: options.enableVideoUnderstanding }),
  });
}

export function codeInterpreter(): GrokProviderTool {
  return grokProviderTool("code_interpreter");
}

export function fileSearch(options: GrokFileSearchOptions): GrokProviderTool {
  const vectorStoreIds = validateStringList(
    options.vectorStoreIds,
    "vectorStoreIds",
    Number.POSITIVE_INFINITY,
  );
  if (vectorStoreIds === undefined || vectorStoreIds.length === 0) {
    throw new TypeError("Grok File Search vectorStoreIds must contain at least one id.");
  }
  if (
    options.maxNumResults !== undefined &&
    (!Number.isInteger(options.maxNumResults) || options.maxNumResults <= 0)
  ) {
    throw new TypeError("Grok File Search maxNumResults must be a positive integer.");
  }
  return grokProviderTool("file_search", {
    vector_store_ids: vectorStoreIds,
    ...(options.maxNumResults === undefined ? {} : { max_num_results: options.maxNumResults }),
  });
}

export function mcp(options: GrokMcpOptions): GrokProviderTool {
  let serverUrl: URL;
  try {
    serverUrl = new URL(options.serverUrl);
  } catch {
    throw new TypeError("Grok MCP serverUrl must be a valid URL.");
  }
  if (serverUrl.protocol !== "https:") {
    throw new TypeError("Grok MCP serverUrl must use HTTPS.");
  }
  const serverLabel = validateNonemptyString(options.serverLabel, "serverLabel");
  const allowedTools = validateStringList(
    options.allowedTools,
    "allowedTools",
    Number.POSITIVE_INFINITY,
  );
  const headers =
    options.headers === undefined
      ? undefined
      : Object.fromEntries(
          Object.entries(options.headers).map(([name, value]) => [
            validateNonemptyString(name, "header name"),
            validateNonemptyString(value, `header "${name}"`),
          ]),
        );

  return grokProviderTool("mcp", {
    server_url: serverUrl.toString(),
    server_label: serverLabel,
    ...(options.serverDescription === undefined
      ? {}
      : {
          server_description: validateNonemptyString(
            options.serverDescription,
            "serverDescription",
          ),
        }),
    ...(allowedTools === undefined ? {} : { allowed_tools: allowedTools }),
    ...(options.authorization === undefined
      ? {}
      : { authorization: validateNonemptyString(options.authorization, "authorization") }),
    ...(headers === undefined ? {} : { headers }),
  });
}

export const tools = {
  webSearch,
  xSearch,
  codeInterpreter,
  fileSearch,
  mcp,
};

function grokProviderTool(name: string, configuration?: JsonObject): GrokProviderTool {
  return {
    kind: "provider",
    provider: "grok",
    name,
    ...(configuration === undefined || Object.keys(configuration).length === 0
      ? {}
      : { configuration }),
  };
}

function validateExclusive(
  left: unknown[] | undefined,
  right: unknown[] | undefined,
  leftName: string,
  rightName: string,
): void {
  if (left !== undefined && right !== undefined) {
    throw new TypeError(`Grok Search ${leftName} and ${rightName} cannot be used together.`);
  }
}

function validateStringList(
  values: string[] | undefined,
  name: string,
  max: number,
): string[] | undefined {
  if (values === undefined) {
    return undefined;
  }
  if (values.length > max) {
    throw new TypeError(`Grok Search ${name} supports at most ${max.toString()} values.`);
  }
  return values.map((value) => validateNonemptyString(value, name));
}

function validateNonemptyString(value: string, name: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new TypeError(`Grok ${name} must be a non-empty string.`);
  }
  return normalized;
}

function validateDate(value: string | undefined, name: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const date = new Date(`${value}T00:00:00Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    Number.isNaN(date.getTime()) ||
    date.toISOString().slice(0, 10) !== value
  ) {
    throw new TypeError(`Grok X Search ${name} must use YYYY-MM-DD format.`);
  }
  return value;
}
