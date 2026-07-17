import { getAssistantGenerationMetadata, type Message } from "@anvia/core/completion";
import type { StudioMemoryMessageRecord } from "../../../../types";
import { Badge } from "../../components/ui/badge";
import { formatRelativeTime } from "../shared/format";

type AssistantMessage = Extract<Message, { role: "assistant" }>;

export type MemoryGenerationRow = {
  position: number;
  runId: string;
  turn: number;
  createdAt: string;
  preview: string;
  generation: ReturnType<typeof getAssistantGenerationMetadata>;
};

export function memoryGenerationRows(records: StudioMemoryMessageRecord[]): MemoryGenerationRow[] {
  return records.flatMap((record) => {
    if (record.message.role !== "assistant") {
      return [];
    }
    return [
      {
        position: record.position,
        runId: record.runId,
        turn: record.turn,
        createdAt: record.createdAt,
        preview: assistantPreview(record.message),
        generation: getAssistantGenerationMetadata(record.message),
      },
    ];
  });
}

export function MemoryGenerationLedger(props: { records: StudioMemoryMessageRecord[] }) {
  const rows = memoryGenerationRows(props.records);
  return (
    <section className="grid min-w-0 overflow-hidden border-y border-border/80">
      <header className="flex min-h-11 items-center justify-between gap-3 bg-muted/10 px-3 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
        <span>Assistant responses</span>
        <span className="font-medium normal-case tracking-normal">{rows.length} responses</span>
      </header>
      {rows.length === 0 ? (
        <div className="border-t border-border/70 px-4 py-8 text-center text-sm text-muted-foreground">
          No persisted assistant responses.
        </div>
      ) : (
        <div className="grid divide-y divide-border/70 border-t border-border/70">
          {rows.map((row) => (
            <GenerationRow row={row} key={`${row.position}:${row.runId}`} />
          ))}
        </div>
      )}
    </section>
  );
}

function GenerationRow(props: { row: MemoryGenerationRow }) {
  const generation = props.row.generation;
  return (
    <article className="grid min-w-0 gap-3 px-3 py-4">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <Badge className="border-border/80 bg-muted/45 text-foreground">
            Turn {props.row.turn}
          </Badge>
          {generation === undefined ? (
            <Badge className="border-border/80 bg-background/40 text-muted-foreground">
              Usage unavailable
            </Badge>
          ) : (
            <>
              <Badge className="border-border/80 bg-muted/45 text-foreground">
                {generation.provider}
              </Badge>
              <Badge className="max-w-full truncate border-border/80 bg-muted/45 text-foreground">
                {generation.model}
              </Badge>
            </>
          )}
        </div>
        <span className="shrink-0 text-xs text-muted-foreground">
          {formatRelativeTime(props.row.createdAt)}
        </span>
      </div>
      <p className="m-0 whitespace-pre-wrap break-words text-sm leading-6 text-foreground">
        {props.row.preview}
      </p>
      {generation === undefined ? null : (
        <div className="flex min-w-0 flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <UsageMetric label="total" value={generation.usage.totalTokens} suffix=" tokens" />
          <UsageMetric label="input" value={generation.usage.inputTokens} />
          <UsageMetric label="output" value={generation.usage.outputTokens} />
          <UsageMetric label="cached" value={generation.usage.cachedInputTokens} />
          <UsageMetric label="cache create" value={generation.usage.cacheCreationInputTokens} />
        </div>
      )}
    </article>
  );
}

function UsageMetric(props: { label: string; value: number; suffix?: string | undefined }) {
  return (
    <span>
      {props.label} {props.value.toLocaleString()}
      {props.suffix}
    </span>
  );
}

function assistantPreview(message: AssistantMessage): string {
  const text = message.content
    .flatMap((content) => (content.type === "text" ? [content.text] : []))
    .join("\n")
    .trim();
  if (text.length > 0) {
    return truncatePreview(text);
  }

  const toolNames = message.content.flatMap((content) =>
    content.type === "tool_call" ? [content.function.name] : [],
  );
  if (toolNames.length > 0) {
    return `Tool call${toolNames.length === 1 ? "" : "s"}: ${toolNames.join(", ")}`;
  }

  const reasoning = message.content
    .flatMap((content) => (content.type === "reasoning" ? [content.text] : []))
    .join("\n")
    .trim();
  if (reasoning.length > 0) {
    return truncatePreview(reasoning);
  }

  const imageCount = message.content.filter((content) => content.type === "image").length;
  return imageCount > 0
    ? `${imageCount} generated image${imageCount === 1 ? "" : "s"}`
    : "Assistant response";
}

function truncatePreview(value: string): string {
  const compact = value.replace(/\s+/g, " ").trim();
  return compact.length > 220 ? `${compact.slice(0, 217)}...` : compact;
}
