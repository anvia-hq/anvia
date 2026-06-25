// Centralized env loading. The actual dotenv loading happens via
// `tsx -r dotenv/config ... dotenv_config_path=../../.env` in the script
// line, but every demo imports this module for typed accessors.

export function loadEnv(): void {
  // No-op. Kept for symmetry so every script reads the same way.
  // Real env loading is handled by tsx + dotenv at the process level.
}

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.length === 0) {
    throw new Error(
      `Missing required env var ${name}. ` + `Set it in the .env at the repo root (../../.env).`,
    );
  }
  return value;
}

export function optionalEnv(name: string): string | undefined {
  const value = process.env[name];
  return value === undefined || value.length === 0 ? undefined : value;
}

export type LangfuseEnv = {
  publicKey: string;
  secretKey: string;
  baseUrl: string;
  environment: string | undefined;
  release: string | undefined;
  serviceName: string | undefined;
};

export function getLangfuseEnv(): LangfuseEnv {
  return {
    publicKey: requireEnv("LANGFUSE_PUBLIC_KEY"),
    secretKey: requireEnv("LANGFUSE_SECRET_KEY"),
    baseUrl: optionalEnv("LANGFUSE_BASE_URL") ?? "https://cloud.langfuse.com",
    environment: optionalEnv("LANGFUSE_TRACING_ENVIRONMENT"),
    release: optionalEnv("LANGFUSE_RELEASE"),
    serviceName: optionalEnv("LANGFUSE_SERVICE_NAME"),
  };
}
