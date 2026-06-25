import { emptyToUndefined } from "./helpers.js";

export const langfuseResolvedConfigSymbol: unique symbol = Symbol.for(
  "@anvia/langfuse.resolvedConfig",
);

export type LangfuseResolvedConfig = {
  publicKey?: string | undefined;
  secretKey?: string | undefined;
  baseUrl: string;
  environment?: string | undefined;
  release?: string | undefined;
  serviceName?: string | undefined;
  timeoutMs: number;
};

export type LangfuseConfigOptions = {
  publicKey?: string | undefined;
  secretKey?: string | undefined;
  baseUrl?: string | undefined;
  environment?: string | undefined;
  release?: string | undefined;
  serviceName?: string | undefined;
  timeoutMs?: number | undefined;
};

export type LangfuseResolvedConfigCarrier = {
  [langfuseResolvedConfigSymbol]?: LangfuseResolvedConfig | undefined;
};

export function resolveLangfuseConfig(
  options: LangfuseConfigOptions = {},
  fallback?: Partial<LangfuseResolvedConfig> | undefined,
): LangfuseResolvedConfig {
  return {
    publicKey: resolveStringOption(
      options.publicKey,
      fallback?.publicKey,
      process.env.LANGFUSE_PUBLIC_KEY,
    ),
    secretKey: resolveStringOption(
      options.secretKey,
      fallback?.secretKey,
      process.env.LANGFUSE_SECRET_KEY,
    ),
    baseUrl:
      resolveStringOption(options.baseUrl, fallback?.baseUrl, process.env.LANGFUSE_BASE_URL) ??
      "https://cloud.langfuse.com",
    environment: resolveStringOption(
      options.environment,
      fallback?.environment,
      process.env.LANGFUSE_TRACING_ENVIRONMENT,
    ),
    release: resolveStringOption(options.release, fallback?.release, process.env.LANGFUSE_RELEASE),
    serviceName: resolveStringOption(
      options.serviceName,
      fallback?.serviceName,
      process.env.LANGFUSE_SERVICE_NAME,
    ),
    timeoutMs: options.timeoutMs ?? fallback?.timeoutMs ?? 30_000,
  };
}

export function getResolvedLangfuseConfig(value: unknown): LangfuseResolvedConfig | undefined {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }
  return (value as LangfuseResolvedConfigCarrier)[langfuseResolvedConfigSymbol];
}

function resolveStringOption(
  option: string | undefined,
  fallback: string | undefined,
  envVar: string | undefined,
): string | undefined {
  return emptyToUndefined(option) ?? emptyToUndefined(fallback) ?? emptyToUndefined(envVar);
}
