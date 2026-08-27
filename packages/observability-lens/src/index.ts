export { resolveLensConfig } from "./config.js";
export { LensDatasetError } from "./dataset-client.js";
export { createLensRedactor, DEFAULT_PATTERNS } from "./redaction.js";
export { LensClient } from "./tracing.js";
export type {
  LensCaptureMode,
  LensClientOptions,
  LensDataset,
  LensDatasetClient,
  LensDatasetClientOptions,
  LensDatasetGetOptions,
  LensDatasetItem,
  LensEvalReporter,
  LensEvalReporterOptions,
  LensObserverOptions,
  LensPipelineObserverOptions,
  LensRedactionOptions,
  LensRedactorPattern,
} from "./types.js";
