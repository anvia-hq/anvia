import type {
  StudioEvalCasePreview,
  StudioEvalMetricSummary,
  StudioEvalSuite,
  StudioEvalSuiteConfig,
} from "../types";
import { compact } from "./compact";
import { toJsonValue } from "./json";

const CASE_PREVIEW_LIMIT = 5;
const PREVIEW_VALUE_MAX_LENGTH = 500;

export function evalConfig(suite: StudioEvalSuite): StudioEvalSuiteConfig {
  const casePreviews = suite.cases.slice(0, CASE_PREVIEW_LIMIT).map(casePreview);
  const metricSummaries = suite.metrics.map(metricSummary);

  return compact({
    id: suite.id ?? suite.name,
    name: suite.name,
    description: suite.description,
    caseCount: suite.cases.length,
    metricNames: suite.metrics.map((metric) => metric.name),
    casePreviewCount: casePreviews.length,
    casePreviews,
    metricSummaries,
    concurrency: suite.concurrency,
    metadata: suite.metadata,
  }) as StudioEvalSuiteConfig;
}

function casePreview(testCase: unknown, index: number): StudioEvalCasePreview {
  if (!isRecord(testCase)) {
    return {
      id: `case-${index + 1}`,
      input: previewValue(testCase),
    };
  }

  return compact({
    id:
      typeof testCase.id === "string" && testCase.id.length > 0 ? testCase.id : `case-${index + 1}`,
    input: "input" in testCase ? previewValue(testCase.input) : undefined,
    expected: "expected" in testCase ? previewValue(testCase.expected) : undefined,
    metadataKeys: metadataKeys(testCase.metadata),
  }) as StudioEvalCasePreview;
}

function metricSummary(metric: unknown, index: number): StudioEvalMetricSummary {
  if (!isRecord(metric)) {
    return { name: `metric-${index + 1}` };
  }

  return compact({
    name:
      typeof metric.name === "string" && metric.name.length > 0
        ? metric.name
        : `metric-${index + 1}`,
    dataType: metricDataType(metric.dataType),
    configId: typeof metric.configId === "string" ? metric.configId : undefined,
    scoreConfigId: typeof metric.scoreConfigId === "string" ? metric.scoreConfigId : undefined,
    metadataKeys: metadataKeys(metric.metadata),
  }) as StudioEvalMetricSummary;
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
