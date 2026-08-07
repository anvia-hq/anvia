import type { LensTracingOptions } from "./types.js";

export type ResolvedLensConfig = {
  baseUrl: string;
  publicKey: string;
  secretKey: string;
  serviceName: string;
  environment: string;
  release?: string | undefined;
  timeoutMs: number;
  captureMode: "safe" | "full";
  captureMaxBytes: number;
};

export function resolveLensConfig(options: LensTracingOptions = {}): ResolvedLensConfig {
  const baseUrl = required("baseUrl", options.baseUrl, process.env.ANVIA_LENS_BASE_URL).replace(
    /\/+$/,
    "",
  );
  const publicKey = required("publicKey", options.publicKey, process.env.ANVIA_LENS_PUBLIC_KEY);
  const secretKey = required("secretKey", options.secretKey, process.env.ANVIA_LENS_SECRET_KEY);
  const serviceName = required(
    "serviceName",
    options.serviceName,
    process.env.ANVIA_LENS_SERVICE_NAME,
  );
  const timeoutMs = options.timeoutMs ?? 30_000;
  const captureMaxBytes = options.captureMaxBytes ?? 262_144;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new TypeError("Anvia Lens timeoutMs must be a positive number");
  }
  if (!Number.isInteger(captureMaxBytes) || captureMaxBytes < 96) {
    throw new TypeError("Anvia Lens captureMaxBytes must be an integer of at least 96 bytes");
  }
  return {
    baseUrl,
    publicKey,
    secretKey,
    serviceName,
    environment:
      first(options.environment, process.env.ANVIA_LENS_ENVIRONMENT, process.env.NODE_ENV) ??
      "default",
    release: first(options.release, process.env.ANVIA_LENS_RELEASE),
    timeoutMs,
    captureMode: options.captureMode ?? "safe",
    captureMaxBytes,
  };
}

function required(
  name: string,
  option: string | undefined,
  environment: string | undefined,
): string {
  const value = first(option, environment);
  if (value === undefined) {
    throw new Error(
      `Anvia Lens ${name} is required; pass it to lens.create() or set ANVIA_LENS_${envName(name)}`,
    );
  }
  return value;
}

function first(...values: Array<string | undefined>): string | undefined {
  return values.find((value) => value !== undefined && value.trim().length > 0)?.trim();
}

function envName(name: string): string {
  return name.replace(/[A-Z]/g, (letter) => `_${letter}`).toUpperCase();
}
