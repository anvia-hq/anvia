import { CaretRight, Check, Copy, MagnifyingGlass } from "@phosphor-icons/react";
import { useId, useMemo, useState } from "react";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { StudioIcon } from "../../components/ui/icon";
import { Input } from "../../components/ui/input";
import { cn } from "../../lib/utils";
import { isRecord } from "../shared/object";
import { jsonSyntaxTokens, TraceJsonTree } from "./trace-browser-detail";
import {
  analyzeTracePayload,
  compactTracePayloadValue,
  flattenTracePayload,
  type TracePayloadField,
  type TracePayloadMessage,
  type TracePayloadTool,
  tracePayloadJson,
  tracePayloadLabel,
} from "./trace-payload";

type TracePayloadMode = "readable" | "structure" | "table" | "raw";
type ViewOption = { id: TracePayloadMode; label: string };

const largePayloadPreviewCharacters = 100_000;

export function TracePayloadSection(props: {
  field: TracePayloadField;
  title: string;
  value: unknown;
}) {
  const serialized = useMemo(() => tracePayloadJson(props.value), [props.value]);
  const tooLarge = serialized.length > largePayloadPreviewCharacters;
  const analysis = useMemo(
    () =>
      (props.field !== "input" && props.field !== "output") || tooLarge
        ? undefined
        : analyzeTracePayload(props.value, props.field),
    [props.field, props.value, tooLarge],
  );
  const options = useMemo<ViewOption[]>(() => {
    if (tooLarge) return [{ id: "raw", label: props.field === "metadata" ? "JSON" : "Raw" }];
    if (props.field === "metadata") {
      return [
        { id: "table", label: "Table" },
        { id: "raw", label: "JSON" },
      ];
    }
    if (analysis?.hasMessages) {
      return [
        { id: "readable", label: props.field === "output" ? "Response" : "Messages" },
        { id: "structure", label: "Structure" },
        { id: "raw", label: "Raw" },
      ];
    }
    return [
      { id: "structure", label: "Structure" },
      { id: "raw", label: "Raw" },
    ];
  }, [analysis?.hasMessages, props.field, tooLarge]);
  const [preferredMode, setPreferredMode] = useState<TracePayloadMode>(
    () => options[0]?.id ?? "raw",
  );
  const mode = options.some((option) => option.id === preferredMode)
    ? preferredMode
    : (options[0]?.id ?? "raw");

  const content =
    props.value === null || props.value === undefined ? (
      <EmptyPayload />
    ) : tooLarge ? (
      <RawJsonBlock json={serialized} title={props.title} truncated />
    ) : mode === "raw" ? (
      <RawJsonBlock json={serialized} title={props.title} />
    ) : mode === "table" ? (
      <MetadataTable value={props.value} />
    ) : mode === "readable" && analysis?.hasMessages ? (
      <ReadableMessages
        additional={analysis.additional}
        messages={analysis.messages}
        tools={analysis.tools}
      />
    ) : (
      <TraceJsonTree value={props.value} />
    );

  if (props.field === "metadata") {
    const fieldCount = tooLarge ? 0 : flattenTracePayload(props.value).length;
    return (
      <details className="group grid min-w-0 gap-3">
        <summary className="flex cursor-pointer list-none items-center gap-2 rounded-sm py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-3 [&::-webkit-details-marker]:hidden">
          <StudioIcon
            icon={CaretRight}
            aria-hidden="true"
            className="size-3.5 text-muted-foreground transition-transform group-open:rotate-90"
          />
          <h3 className="m-0 text-sm font-semibold">{props.title}</h3>
          <span className="ml-auto font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
            {tooLarge ? "Large payload" : `${fieldCount} ${fieldCount === 1 ? "field" : "fields"}`}
          </span>
        </summary>
        <div className="grid gap-3 pl-5">
          <PayloadModeSwitch options={options} value={mode} onChange={setPreferredMode} />
          {content}
        </div>
      </details>
    );
  }

  return (
    <section className="grid min-w-0 gap-3" aria-label={`${props.title} payload`}>
      <header className="flex min-w-0 items-center gap-3">
        <h3 className="m-0 text-sm font-semibold">{props.title}</h3>
        <div className="ml-auto">
          <PayloadModeSwitch options={options} value={mode} onChange={setPreferredMode} />
        </div>
      </header>
      {content}
    </section>
  );
}

function PayloadModeSwitch(props: {
  options: ViewOption[];
  value: TracePayloadMode;
  onChange: (mode: TracePayloadMode) => void;
}) {
  if (props.options.length < 2) return null;
  return (
    <fieldset
      className="flex h-7 shrink-0 items-center rounded-md border p-0.5"
      aria-label="Field view"
    >
      {props.options.map((option) => (
        <button
          aria-pressed={props.value === option.id}
          className={cn(
            "h-5 rounded px-2 font-mono text-[10px] font-medium uppercase tracking-wide text-muted-foreground",
            props.value === option.id && "bg-accent text-foreground",
          )}
          key={option.id}
          type="button"
          onClick={() => props.onChange(option.id)}
        >
          {option.label}
        </button>
      ))}
    </fieldset>
  );
}

function ReadableMessages(props: {
  messages: TracePayloadMessage[];
  tools: TracePayloadTool[];
  additional: unknown;
}) {
  return (
    <div className="grid min-w-0 gap-5">
      <div className="grid gap-5">
        {props.messages.map((message) => (
          <article
            className="grid min-w-0 grid-cols-[6.5rem_minmax(0,1fr)] gap-3 max-sm:grid-cols-1"
            key={message.key}
          >
            <div className="pt-0.5">
              <RoleBadge role={message.role} />
            </div>
            <div className="grid min-w-0 gap-3">
              {message.content.length > 0 ? (
                <p className="m-0 whitespace-pre-wrap break-words text-sm leading-6">
                  {message.content}
                </p>
              ) : message.toolCalls.length === 0 ? (
                <span className="text-sm italic text-muted-foreground">No text content</span>
              ) : null}
              {message.toolCalls.map((tool) => (
                <ToolDisclosure key={tool.key} tool={tool} label="Tool call" />
              ))}
            </div>
          </article>
        ))}
      </div>
      {props.tools.length > 0 ? (
        <section>
          <p className="mb-3 font-mono text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            Available tools · {props.tools.length}
          </p>
          <div className="grid gap-2">
            {props.tools.map((tool) => (
              <ToolDisclosure key={tool.key} tool={tool} label="Definition" />
            ))}
          </div>
        </section>
      ) : null}
      {props.additional !== undefined ? (
        <details className="group/additional">
          <summary className="flex cursor-pointer list-none items-center gap-2 text-xs font-medium text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-3 [&::-webkit-details-marker]:hidden">
            <StudioIcon
              icon={CaretRight}
              aria-hidden="true"
              className="size-3 transition-transform group-open/additional:rotate-90"
            />
            Additional fields
          </summary>
          <div className="mt-3 border-l pl-4">
            <StructuredPayload value={props.additional} />
          </div>
        </details>
      ) : null}
    </div>
  );
}

function RoleBadge({ role }: { role: string }) {
  return (
    <Badge
      className={cn(
        "border-hair bg-status-neutral-fill text-status-neutral-ink",
        role === "tool" && "border-tone-tool bg-transparent text-tone-tool",
        role === "assistant" && "text-foreground",
      )}
    >
      {tracePayloadLabel(role)}
    </Badge>
  );
}

function ToolDisclosure(props: { tool: TracePayloadTool; label: string }) {
  return (
    <details className="border-l-2 border-tone-tool pl-3">
      <summary className="cursor-pointer list-none py-1 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-3 [&::-webkit-details-marker]:hidden">
        <span className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
          {props.label}
        </span>{" "}
        <span className="font-semibold">{props.tool.name}</span>
        {props.tool.description ? (
          <span className="ml-2 text-muted-foreground">{props.tool.description}</span>
        ) : null}
      </summary>
      <div className="py-2">
        <StructuredPayload value={props.tool.value} />
      </div>
    </details>
  );
}

function MetadataTable({ value }: { value: unknown }) {
  const searchId = useId();
  const entries = useMemo(() => flattenTracePayload(value), [value]);
  const [query, setQuery] = useState("");
  const normalized = query.trim().toLowerCase();
  const visible = normalized
    ? entries.filter(
        (entry) =>
          entry.path.toLowerCase().includes(normalized) ||
          compactTracePayloadValue(entry.value).toLowerCase().includes(normalized),
      )
    : entries;
  return (
    <div className="grid gap-2">
      <label className="relative block" htmlFor={searchId}>
        <StudioIcon
          icon={MagnifyingGlass}
          aria-hidden="true"
          className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          aria-label="Search metadata"
          className="h-8 pl-8 font-mono text-xs"
          id={searchId}
          placeholder="Search metadata"
          value={query}
          onChange={(event) => setQuery(event.currentTarget.value)}
        />
      </label>
      <div className="min-w-0 overflow-hidden">
        {visible.length > 0 ? (
          <dl className="grid gap-1">
            {visible.map((entry) => (
              <div
                className="grid min-w-0 grid-cols-[minmax(8rem,0.42fr)_minmax(0,1fr)] gap-4 py-2 text-xs max-sm:grid-cols-1 max-sm:gap-1"
                key={entry.path}
              >
                <dt className="break-all font-mono text-muted-foreground" title={entry.path}>
                  {entry.path || entry.label}
                </dt>
                <dd className="m-0 whitespace-pre-wrap break-words font-mono">
                  {compactTracePayloadValue(entry.value)}
                </dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="py-6 text-center text-sm text-muted-foreground">No matching fields</p>
        )}
      </div>
    </div>
  );
}

function StructuredPayload({ value }: { value: unknown }) {
  if (Array.isArray(value)) {
    if (value.length === 0) return <PrimitiveValue value={value} />;
    return (
      <div className="grid gap-1">
        {value.map((item, index) => (
          <StructuredRow
            depth={0}
            key={`${index}:${tracePayloadJson(item).slice(0, 80)}`}
            label={String(index)}
            value={item}
          />
        ))}
      </div>
    );
  }
  if (isRecord(value)) {
    const entries = Object.entries(value);
    if (entries.length === 0) return <PrimitiveValue value={value} />;
    return (
      <div className="grid gap-1">
        {entries.map(([key, item]) => (
          <StructuredRow depth={0} key={key} label={key} value={item} />
        ))}
      </div>
    );
  }
  return <PrimitiveValue value={value} />;
}

function StructuredRow(props: { label: string; value: unknown; depth: number }) {
  const nested = Array.isArray(props.value) || isRecord(props.value);
  if (!nested) {
    return (
      <div className="grid min-w-0 grid-cols-[minmax(7rem,0.34fr)_minmax(0,1fr)] gap-4 py-2 text-xs max-sm:grid-cols-1 max-sm:gap-1">
        <span className="break-all font-mono text-muted-foreground">{props.label}</span>
        <PrimitiveValue value={props.value} />
      </div>
    );
  }
  const entries = Array.isArray(props.value)
    ? props.value.map((item, index) => [String(index), item] as const)
    : isRecord(props.value)
      ? Object.entries(props.value)
      : [];
  return (
    <details open={props.depth < 1} className="group/row py-2">
      <summary className="flex cursor-pointer list-none items-center gap-2 font-mono text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-3 [&::-webkit-details-marker]:hidden">
        <StudioIcon
          icon={CaretRight}
          aria-hidden="true"
          className="size-3 text-muted-foreground transition-transform group-open/row:rotate-90"
        />
        <span>{props.label}</span>
        <span className="text-[10px] text-muted-foreground">
          {Array.isArray(props.value) ? `${entries.length} items` : `${entries.length} fields`}
        </span>
      </summary>
      <div className="ml-1.5 mt-2 grid gap-1 border-l pl-4">
        {entries.length > 0 ? (
          entries.map(([key, item]) => (
            <StructuredRow
              depth={props.depth + 1}
              key={`${props.label}:${key}`}
              label={key}
              value={item}
            />
          ))
        ) : (
          <PrimitiveValue value={props.value} />
        )}
      </div>
    </details>
  );
}

function PrimitiveValue({ value }: { value: unknown }) {
  return (
    <span
      className={cn(
        "min-w-0 whitespace-pre-wrap break-words font-mono text-xs",
        (value === null || value === undefined) && "code-comment",
        typeof value === "string" && "code-string",
        typeof value === "number" && "code-number",
        typeof value === "boolean" && "code-literal",
      )}
    >
      {compactTracePayloadValue(value)}
    </span>
  );
}

function RawJsonBlock(props: { json: string; title: string; truncated?: boolean }) {
  const [copied, setCopied] = useState(false);
  const preview = props.truncated ? props.json.slice(0, largePayloadPreviewCharacters) : props.json;
  return (
    <div className="relative min-w-0 rounded-lg border bg-muted">
      {props.truncated ? (
        <p className="m-0 border-b px-3 py-2 text-xs text-muted-foreground">
          Large payload · showing the first {largePayloadPreviewCharacters.toLocaleString()}{" "}
          characters
        </p>
      ) : null}
      <Button
        aria-label={`Copy ${props.title} JSON`}
        className="absolute right-2 top-2 z-10"
        size="icon"
        title={copied ? "Copied" : "Copy JSON"}
        type="button"
        variant="secondary"
        onClick={() => {
          const write = navigator.clipboard?.writeText(props.json);
          if (write === undefined) return;
          void write.then(
            () => {
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1_500);
            },
            () => undefined,
          );
        }}
      >
        <StudioIcon icon={copied ? Check : Copy} aria-hidden="true" />
      </Button>
      <pre className="m-0 max-h-[32rem] overflow-auto p-4 pr-12 font-mono text-xs leading-5 text-foreground">
        {jsonSyntaxTokens(preview).map((token) => (
          <span
            className={cn(
              token.type === "key" && "code-keyword",
              token.type === "string" && "code-string",
              token.type === "number" && "code-number",
              token.type === "boolean" && "code-literal",
              token.type === "null" && "code-comment",
            )}
            key={token.start}
          >
            {token.text}
          </span>
        ))}
        {props.truncated ? "\n… display truncated" : null}
      </pre>
    </div>
  );
}

function EmptyPayload() {
  return (
    <div className="border-y border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
      No data captured
    </div>
  );
}
