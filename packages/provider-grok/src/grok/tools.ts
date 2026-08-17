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

  const configuration: JsonObject = {};
  if (Object.keys(filters).length > 0) configuration.filters = filters;
  if (options.enableImageUnderstanding !== undefined) {
    configuration.enable_image_understanding = options.enableImageUnderstanding;
  }
  if (options.enableImageSearch !== undefined) {
    configuration.enable_image_search = options.enableImageSearch;
  }
  return grokProviderTool("web_search", configuration);
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

  const configuration: JsonObject = {};
  if (allowedHandles !== undefined) configuration.allowed_x_handles = allowedHandles;
  if (excludedHandles !== undefined) configuration.excluded_x_handles = excludedHandles;
  if (fromDate !== undefined) configuration.from_date = fromDate;
  if (toDate !== undefined) configuration.to_date = toDate;
  if (options.enableImageUnderstanding !== undefined) {
    configuration.enable_image_understanding = options.enableImageUnderstanding;
  }
  if (options.enableVideoUnderstanding !== undefined) {
    configuration.enable_video_understanding = options.enableVideoUnderstanding;
  }
  return grokProviderTool("x_search", configuration);
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
  const configuration: JsonObject = { vector_store_ids: vectorStoreIds };
  if (options.maxNumResults !== undefined) configuration.max_num_results = options.maxNumResults;
  return grokProviderTool("file_search", configuration);
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

  const configuration: JsonObject = {
    server_url: serverUrl.toString(),
    server_label: serverLabel,
  };
  if (options.serverDescription !== undefined) {
    configuration.server_description = validateNonemptyString(
      options.serverDescription,
      "serverDescription",
    );
  }
  if (allowedTools !== undefined) configuration.allowed_tools = allowedTools;
  if (options.authorization !== undefined) {
    configuration.authorization = validateNonemptyString(options.authorization, "authorization");
  }
  if (headers !== undefined) configuration.headers = headers;
  return grokProviderTool("mcp", configuration);
}

export const tools = {
  webSearch,
  xSearch,
  codeInterpreter,
  fileSearch,
  mcp,
};

function grokProviderTool(name: string, configuration?: JsonObject): GrokProviderTool {
  let tool: GrokProviderTool = {
    kind: "provider",
    provider: "grok",
    name,
  };
  if (configuration !== undefined && Object.keys(configuration).length > 0) {
    tool = { ...tool, configuration };
  }
  return tool;
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
