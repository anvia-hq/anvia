import type React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "../../lib/utils";
import { parseToolDisplayValue } from "./format";
import { isRecord } from "./object";

export function MarkdownText(props: { text: string; size?: "sm" | "base" }) {
  return (
    <div
      className={cn(
        "prose max-w-none text-current [overflow-wrap:anywhere] prose-headings:text-current prose-headings:font-semibold prose-p:text-current prose-p:leading-7 prose-a:text-current prose-a:decoration-muted-foreground prose-a:underline-offset-2 prose-strong:text-current prose-code:rounded-lg prose-code:border prose-code:border-border/80 prose-code:bg-muted/80 prose-code:px-1 prose-code:py-0.5 prose-code:text-sm prose-code:font-semibold prose-code:text-current prose-code:before:content-none prose-code:after:content-none prose-pre:overflow-auto prose-pre:rounded-lg prose-pre:border prose-pre:border-border/80 prose-pre:bg-card/90 prose-pre:text-current prose-blockquote:border-border prose-blockquote:text-muted-foreground prose-li:marker:text-muted-foreground prose-hr:border-border prose-table:m-0 prose-thead:border-0 prose-tr:border-0 prose-th:p-0 prose-td:p-0 dark:prose-invert dark:prose-headings:text-current dark:prose-p:text-current dark:prose-strong:text-current dark:prose-code:text-current dark:prose-pre:bg-card dark:prose-pre:text-current",
        props.size === "base" ? "text-base" : "prose-sm",
      )}
    >
      <ReactMarkdown
        components={{
          table({ children }) {
            return (
              <div className="my-4 w-full min-w-0 overflow-hidden rounded-lg border border-border/80 bg-card/90 shadow-sm">
                <div className="min-w-0 overflow-x-auto">
                  <table
                    className={cn(
                      "m-0 w-full min-w-full border-separate border-spacing-0 text-left",
                      props.size === "base" ? "text-base" : "text-sm",
                    )}
                  >
                    {children}
                  </table>
                </div>
              </div>
            );
          },
          thead({ children }) {
            return <thead className="bg-muted/45">{children}</thead>;
          },
          tbody({ children }) {
            return <tbody>{children}</tbody>;
          },
          tr({ children }) {
            return <tr className="group/row align-top">{children}</tr>;
          },
          th({ children }) {
            return (
              <th
                className="border-b border-border px-4 text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground first:pl-5 last:pr-5"
                style={{ paddingBottom: "0.625rem", paddingTop: "0.625rem" }}
              >
                {children}
              </th>
            );
          },
          td({ children }) {
            return (
              <td
                className={cn(
                  "border-b border-border/70 px-4 leading-6 text-foreground [overflow-wrap:anywhere] first:pl-5 last:pr-5 group-last/row:border-b-0",
                  props.size === "base" ? "text-base" : "text-sm",
                )}
                style={{ paddingBottom: "0.75rem", paddingTop: "0.75rem" }}
              >
                {children}
              </td>
            );
          },
        }}
        remarkPlugins={[remarkGfm]}
      >
        {props.text}
      </ReactMarkdown>
    </div>
  );
}

export function ToolPayload(props: { title: string; value: string }) {
  const display = toolPayloadDisplay(props.value);

  return (
    <section className="overflow-hidden rounded-lg border border-border/80 bg-background/70">
      <div className="flex min-h-9 items-center gap-3 border-b border-border/80 bg-muted/20 px-3">
        <div className=" text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          {props.title}
        </div>
      </div>
      <div className="min-w-0 overflow-x-auto">
        <pre className="m-0 min-w-max p-3 text-sm leading-6 text-foreground">
          <code>
            <JsonSyntax text={display} />
          </code>
        </pre>
      </div>
    </section>
  );
}

function toolPayloadDisplay(value: string): string {
  const parsed = parseToolDisplayValue(value);
  const displayValue = parsed.kind === "json" ? parsed.value : value;

  try {
    return JSON.stringify(displayValue, null, 2);
  } catch {
    return JSON.stringify(String(displayValue), null, 2);
  }
}

export function JsonSyntax(props: { text: string }) {
  const tokenPattern =
    /"(?:\\.|[^"\\])*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|\btrue\b|\bfalse\b|\bnull\b|[{}[\],:]/g;
  const nodes: React.ReactNode[] = [];
  let lastIndex = 0;
  let match = tokenPattern.exec(props.text);

  while (match !== null) {
    if (match.index > lastIndex) {
      nodes.push(props.text.slice(lastIndex, match.index));
    }

    const token = match[0];
    const nextNonSpace = props.text.slice(tokenPattern.lastIndex).match(/\S/)?.[0];
    const kind = jsonTokenKind(token, nextNonSpace);
    nodes.push(
      <span className={jsonTokenClass(kind)} key={`${match.index}:${token}`}>
        {token}
      </span>,
    );
    lastIndex = tokenPattern.lastIndex;
    match = tokenPattern.exec(props.text);
  }

  if (lastIndex < props.text.length) {
    nodes.push(props.text.slice(lastIndex));
  }

  return <>{nodes}</>;
}

function jsonTokenKind(
  token: string,
  nextNonSpace: string | undefined,
): "key" | "string" | "number" | "boolean" | "null" | "punctuation" {
  if (token.startsWith('"')) {
    return nextNonSpace === ":" ? "key" : "string";
  }
  if (token === "true" || token === "false") {
    return "boolean";
  }
  if (token === "null") {
    return "null";
  }
  if (/^-?\d/.test(token)) {
    return "number";
  }
  return "punctuation";
}

function jsonTokenClass(kind: ReturnType<typeof jsonTokenKind>): string {
  switch (kind) {
    case "key":
      return "text-foreground";
    case "string":
      return "text-foreground dark:text-zinc-100";
    case "number":
      return "text-muted-foreground dark:text-muted-foreground";
    case "boolean":
      return "text-destructive dark:text-destructive";
    case "null":
      return "text-muted-foreground";
    case "punctuation":
      return "text-muted-foreground";
  }
}

export function JsonValueView(props: { value: unknown }) {
  if (Array.isArray(props.value)) {
    if (props.value.length === 0) {
      return <span className="italic text-muted-foreground">Empty array</span>;
    }

    return (
      <div className="grid gap-1.5">
        {Object.entries(props.value).map(([key, item]) => (
          <JsonRow key={key} label={key} value={item} />
        ))}
      </div>
    );
  }

  if (isRecord(props.value)) {
    const entries = Object.entries(props.value);
    if (entries.length === 0) {
      return <span className="italic text-muted-foreground">Empty object</span>;
    }

    return (
      <div className="grid gap-1.5">
        {entries.map(([key, value]) => (
          <JsonRow key={key} label={key} value={value} />
        ))}
      </div>
    );
  }

  return <JsonScalar value={props.value} />;
}

function JsonRow(props: { label: string; value: unknown }) {
  const nested = Array.isArray(props.value) || isRecord(props.value);
  return (
    <div
      className={cn(
        "grid min-w-0 grid-cols-[minmax(92px,max-content)_minmax(0,1fr)] items-baseline gap-2.5",
        nested && "items-start",
      )}
    >
      <div className="text-xs font-semibold text-muted-foreground [overflow-wrap:anywhere]">
        {props.label}
      </div>
      <div className="min-w-0 text-sm leading-5 text-foreground [overflow-wrap:anywhere] [&_.grid]:mt-2 [&_.grid]:border-l [&_.grid]:border-border [&_.grid]:pl-3">
        {nested ? <JsonValueView value={props.value} /> : <JsonScalar value={props.value} />}
      </div>
    </div>
  );
}

function JsonScalar(props: { value: unknown }) {
  if (props.value === null) {
    return <span className="italic text-muted-foreground">null</span>;
  }
  if (typeof props.value === "string") {
    return <span>{props.value}</span>;
  }
  if (typeof props.value === "number") {
    return <span>{props.value}</span>;
  }
  if (typeof props.value === "boolean") {
    return <span>{String(props.value)}</span>;
  }
  return <span>{String(props.value)}</span>;
}
