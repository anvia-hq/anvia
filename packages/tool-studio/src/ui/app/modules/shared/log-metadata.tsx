import { cn } from "../../lib/utils";

type MetadataValue = unknown;

type InlineMetadataItem = {
  key: string;
  value: string;
  tone: "default" | "error";
};

export function LogMetadata(props: {
  metadata?: Record<string, MetadataValue> | undefined;
  limit?: number;
}) {
  const items = inlineMetadataItems(props.metadata, props.limit);
  const hasStructuredDetails = hasStructuredMetadata(props.metadata);
  if (items.length === 0 && !hasStructuredDetails) {
    return null;
  }
  return (
    <div className="grid min-w-0 gap-1 text-xs leading-5 text-muted-foreground">
      {items.length === 0 ? null : (
        <div className="flex min-w-0 flex-wrap gap-x-2 gap-y-1">
          {items.map((item) => (
            <span
              className={cn(
                "min-w-0 break-words",
                item.tone === "error" ? "text-destructive/85" : "text-muted-foreground/85",
              )}
              key={item.key}
            >
              <span className="text-muted-foreground">{item.key}=</span>
              {item.value}
            </span>
          ))}
        </div>
      )}
      {hasStructuredDetails ? (
        <details className="group min-w-0 rounded-lg border border-black/[0.06] bg-black/[0.03] px-2 py-1 dark:border-white/[0.06] dark:bg-white/[0.03]">
          <summary className="cursor-pointer select-none text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground transition group-open:text-foreground">
            Details
          </summary>
          <pre className="m-0 mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words text-xs leading-4 text-muted-foreground">
            {formatStructuredDetails(props.metadata)}
          </pre>
        </details>
      ) : null}
    </div>
  );
}

export function formatLogMetadataText(
  metadata?: Record<string, MetadataValue>,
  limit?: number,
): string {
  return inlineMetadataItems(metadata, limit)
    .map((item) => `${item.key}=${item.value}`)
    .join(" ");
}

function inlineMetadataItems(
  metadata?: Record<string, MetadataValue>,
  limit = 6,
): InlineMetadataItem[] {
  return Object.entries(metadata ?? {})
    .map(([key, value]): InlineMetadataItem => {
      const tone: InlineMetadataItem["tone"] = key === "error" ? "error" : "default";
      return {
        key,
        value: formatInlineMetadataValue(key, value),
        tone,
      };
    })
    .filter((item) => item.value.length > 0)
    .slice(0, limit);
}

function formatInlineMetadataValue(key: string, value: MetadataValue): string {
  if (value === null) {
    return "null";
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) {
    return `[${value.length}]`;
  }
  if (isRecord(value)) {
    if (key === "error") {
      return formatErrorMetadata(value);
    }
    return compactJson(value);
  }
  return "";
}

function formatErrorMetadata(value: Record<string, MetadataValue>): string {
  const name = typeof value.name === "string" && value.name.length > 0 ? value.name : undefined;
  const message =
    typeof value.message === "string" && value.message.length > 0 ? value.message : undefined;
  if (name !== undefined && message !== undefined) {
    return `${name}: ${message}`;
  }
  if (message !== undefined) {
    return message;
  }
  return compactJson(value);
}

function hasStructuredMetadata(metadata?: Record<string, MetadataValue>): boolean {
  return Object.values(metadata ?? {}).some((value) => Array.isArray(value) || isRecord(value));
}

function formatStructuredDetails(metadata?: Record<string, MetadataValue>): string {
  if (metadata === undefined) {
    return "";
  }
  try {
    return JSON.stringify(metadata, null, 2);
  } catch {
    return String(metadata);
  }
}

function compactJson(value: MetadataValue): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function isRecord(value: MetadataValue): value is Record<string, MetadataValue> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
