export { resolveLensConfig } from "./config.js";
export { createLensRedactor, DEFAULT_PATTERNS } from "./redaction.js";
export { createLensEvalReporter, lens } from "./tracing.js";
export type {
  LensCaptureMode,
  LensEvalReporter,
  LensEvalReporterOptions,
  LensRedactionOptions,
  LensRedactorPattern,
  LensTracing,
  LensTracingOptions,
} from "./types.js";
