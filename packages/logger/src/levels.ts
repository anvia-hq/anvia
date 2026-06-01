import type { LogLevel } from "./types";

const levelPriority: Record<Exclude<LogLevel, "silent">, number> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
};

export function shouldLog(
  configuredLevel: LogLevel,
  messageLevel: Exclude<LogLevel, "silent">,
): boolean {
  if (configuredLevel === "silent") {
    return false;
  }

  return levelPriority[messageLevel] >= levelPriority[configuredLevel];
}

export function resolveLogLevel(level: LogLevel | undefined): LogLevel {
  if (level !== undefined) {
    return level;
  }

  const envLevel = readEnv("ANVIA_LOG_LEVEL") ?? readEnv("LOG_LEVEL");
  if (isLogLevel(envLevel)) {
    return envLevel;
  }

  return readEnv("NODE_ENV") === "production" ? "error" : "info";
}

function readEnv(name: string): string | undefined {
  return typeof process === "undefined" ? undefined : process.env[name];
}

function isLogLevel(value: string | undefined): value is LogLevel {
  return (
    value === "trace" ||
    value === "debug" ||
    value === "info" ||
    value === "warn" ||
    value === "error" ||
    value === "fatal" ||
    value === "silent"
  );
}
