import type {
  StudioEvalCasePreview,
  StudioEvalMetricSummary,
  StudioEvalSuite,
  StudioEvalSuiteConfig,
} from "../types";
import { toJsonValue } from "./json";

const CASE_PREVIEW_LIMIT = 5;
const PREVIEW_VALUE_MAX_LENGTH = 500;

export function evalConfig(suite: StudioEvalSuite): StudioEvalSuiteConfig {
  const casePreviews = suite.cases.slice(0, CASE_PREVIEW_LIMIT).map(casePreview);
  const metricSummaries = suite.metrics.map(metricSummary);

  const config: StudioEvalSuiteConfig = {
    id: suite.id ?? suite.name,
    name: suite.name,
    caseCount: suite.cases.length,
    metricNames: suite.metrics.map((metric) => metric.name),
    casePreviewCount: casePreviews.length,
    casePreviews,
    metricSummaries,
  };
  if (suite.description !== undefined) config.description = suite.description;
  if (suite.concurrency !== undefined) config.concurrency = suite.concurrency;
  if (suite.metadata !== undefined) config.metadata = suite.metadata;
  return config;
}

function casePreview(testCase: unknown, index: number): StudioEvalCasePreview {
  if (!isRecord(testCase)) {
    return {
      id: `case-${index + 1}`,
      input: previewValue(testCase),
    };
  }

  const preview: StudioEvalCasePreview = {
    id:
      typeof testCase.id === "string" && testCase.id.length > 0 ? testCase.id : `case-${index + 1}`,
  };
  if ("input" in testCase) preview.input = previewValue(testCase.input);
  if ("expected" in testCase) preview.expected = previewValue(testCase.expected);
  const keys = metadataKeys(testCase.metadata);
  if (keys !== undefined) preview.metadataKeys = keys;
  return preview;
}

function metricSummary(metric: unknown, index: number): StudioEvalMetricSummary {
  if (!isRecord(metric)) {
    return { name: `metric-${index + 1}` };
  }

  const summary: StudioEvalMetricSummary = {
    name:
      typeof metric.name === "string" && metric.name.length > 0
        ? metric.name
        : `metric-${index + 1}`,
  };
  const dataType = metricDataType(metric.dataType);
  if (dataType !== undefined) summary.dataType = dataType;
  if (typeof metric.configId === "string") summary.configId = metric.configId;
  if (typeof metric.scoreConfigId === "string") summary.scoreConfigId = metric.scoreConfigId;
  const keys = metadataKeys(metric.metadata);
  if (keys !== undefined) summary.metadataKeys = keys;
  return summary;
}

function previewValue(value: unknown) {
  const jsonValue = toJsonValue(value);
  const serialized = JSON.stringify(jsonValue);
  if (serialized.length <= PREVIEW_VALUE_MAX_LENGTH) {
    return jsonValue;
  }
  return `${serialized.slice(0, PREVIEW_VALUE_MAX_LENGTH)}...`;
}

function metadataKeys(value: unknown): string[] | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const keys = Object.keys(value).filter((key) => value[key] !== undefined);
  return keys.length > 0 ? keys : undefined;
}

function metricDataType(value: unknown): StudioEvalMetricSummary["dataType"] | undefined {
  return value === "NUMERIC" || value === "CATEGORICAL" || value === "BOOLEAN" ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
