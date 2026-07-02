import type { ReactNode } from "react";
import type { StudioAgentToolMetadata, StudioToolRunResponse } from "../../../../types";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { parseToolDisplayValue } from "../shared/format";
import { isRecord } from "../shared/object";
import { JsonSyntax } from "../shared/renderers";
import { SchemaArgumentEditor } from "./schema-argument-editor";

export type ToolRunState = "idle" | "running";

export function ToolRunner(props: {
  selectedTool: StudioAgentToolMetadata | undefined;
  argsText: string;
  runState: ToolRunState;
  runError: string;
  runResponse: StudioToolRunResponse | undefined;
  onArgsTextChange: (value: string) => void;
  onRun: () => void;
}) {
  const propertyCount =
    props.selectedTool === undefined ? 0 : schemaPropertyCount(props.selectedTool.parameters);
  return (
    <section className="grid gap-4 border-t border-border/80 pt-4 xl:grid-cols-[minmax(260px,0.42fr)_minmax(0,1fr)]">
      <div className="grid content-start gap-3">
        <div className="grid gap-1.5">
          <h2 className="m-0 text-base font-semibold text-foreground">Runner</h2>
          {props.selectedTool === undefined ? (
            <p className="m-0 text-sm leading-6 text-muted-foreground">No tool selected</p>
          ) : (
            <>
              <p className="m-0 break-all text-sm font-semibold leading-6 text-foreground">
                {props.selectedTool.name}
              </p>
              <p className="m-0 max-w-[62ch] text-sm leading-6 text-muted-foreground">
                {props.selectedTool.description}
              </p>
            </>
          )}
        </div>
        {props.selectedTool === undefined ? null : (
          <div className="flex min-w-0 flex-wrap gap-2">
            <Badge className={originBadgeClass(props.selectedTool)}>
              {toolOriginLabel(props.selectedTool)}
            </Badge>
            <Badge className={approvalBadgeClass(props.selectedTool.approval.required)}>
              approval {props.selectedTool.approval.required ? "required" : "none"}
            </Badge>
            <ToolMetaPill>
              {propertyCount} {propertyCount === 1 ? "field" : "fields"}
            </ToolMetaPill>
          </div>
        )}
        {props.selectedTool?.approval.reason === undefined ? null : (
          <p className="m-0 border-l border-border/80 pl-3 text-xs leading-5 text-muted-foreground">
            {props.selectedTool.approval.reason}
          </p>
        )}
      </div>
      <div className="grid min-w-0 gap-3">
        <SchemaArgumentEditor
          disabled={props.selectedTool === undefined}
          schema={props.selectedTool?.parameters}
          value={props.argsText}
          onChange={props.onArgsTextChange}
        />
        <div className="flex min-w-0 items-center justify-between gap-3">
          <span className="min-w-0 truncate text-xs text-muted-foreground">
            Arguments must be valid JSON.
          </span>
          <Button
            className="h-8 min-h-8 rounded-md px-4 text-xs"
            type="button"
            disabled={props.runState === "running" || props.selectedTool === undefined}
            onClick={props.onRun}
          >
            {props.runState === "running" ? "Running" : "Run"}
          </Button>
        </div>
        {props.runError.length > 0 ? (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs leading-5 text-destructive">
            {props.runError}
          </div>
        ) : null}
        {props.selectedTool === undefined ? null : (
          <details className="group border-t border-border/70 pt-3">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground marker:hidden">
              Parameter schema
              <span className="font-medium normal-case tracking-normal">
                {schemaType(props.selectedTool.parameters)}
              </span>
            </summary>
            <div className="mt-3">
              <SchemaBlock value={props.selectedTool.parameters} title="JSON schema" />
            </div>
          </details>
        )}
        {props.runResponse === undefined ? null : <ToolRunResult response={props.runResponse} />}
      </div>
    </section>
  );
}

function ToolRunResult(props: { response: StudioToolRunResponse }) {
  const hasResult = Object.hasOwn(props.response, "result");
  const primaryValue = hasResult ? props.response.result : props.response.error;
  const title = hasResult ? "Tool result" : "Tool error";

  return (
    <div className="grid gap-3">
      <SchemaBlock value={displayToolRunValue(primaryValue)} title={title} />
      <details className="group border-t border-border/70 pt-3">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground marker:hidden">
          Raw run response
          <span className="font-medium normal-case tracking-normal">
            {props.response.status} / {props.response.durationMs}ms
          </span>
        </summary>
        <div className="mt-3">
          <SchemaBlock value={props.response} title="Studio envelope" />
        </div>
      </details>
    </div>
  );
}

export function SchemaBlock(props: { value: unknown; title: string }) {
  return (
    <section className="grid min-w-0 content-start overflow-hidden rounded-lg bg-background/45">
      <div className="flex min-h-9 items-center justify-between gap-3 bg-muted/20 px-4">
        <span className=" text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
          {props.title}
        </span>
        <span className=" text-xs text-muted-foreground">{schemaType(props.value)}</span>
      </div>
      <div className="min-w-0 overflow-x-auto">
        <pre className="m-0 max-h-96 min-w-max p-4 text-xs leading-5 text-foreground">
          <code>
            <JsonSyntax text={formatSchema(props.value)} />
          </code>
        </pre>
      </div>
    </section>
  );
}

export function ToolMetaPill(props: { children: ReactNode }) {
  return (
    <span className="inline-flex min-h-7 items-center rounded-md bg-muted/25 px-2.5 text-xs font-medium text-muted-foreground">
      {props.children}
    </span>
  );
}

export function approvalBadgeClass(required: boolean): string {
  return required
    ? "border-border/80 bg-muted/35 text-foreground"
    : "border-transparent bg-transparent text-muted-foreground/60";
}

export function sourceBadgeClass(source: "static" | "dynamic"): string {
  return source === "dynamic"
    ? "border-border/80 bg-muted/45 text-foreground"
    : "border-border/80 bg-muted/55 text-muted-foreground";
}

export function originBadgeClass(tool: StudioAgentToolMetadata): string {
  return tool.mcpServerName === undefined
    ? sourceBadgeClass(tool.source)
    : "border-border/80 bg-muted/35 text-foreground";
}

export function toolOriginLabel(tool: StudioAgentToolMetadata): string {
  return tool.mcpServerName === undefined ? tool.source : `MCP / ${tool.mcpServerName}`;
}

export function schemaType(value: unknown): string {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return "value";
  }
  const type = (value as { type?: unknown }).type;
  return typeof type === "string" ? type : "object";
}

export function schemaPropertyCount(value: unknown): number {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return 0;
  }
  const properties = (value as { properties?: unknown }).properties;
  return typeof properties === "object" && properties !== null && !Array.isArray(properties)
    ? Object.keys(properties).length
    : 0;
}

export function formatJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function parseStudioToolRunResponse(value: unknown): StudioToolRunResponse | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  if (typeof value.agentId !== "string" || value.agentId.length === 0) {
    return undefined;
  }
  if (typeof value.toolName !== "string" || value.toolName.length === 0) {
    return undefined;
  }
  if (value.status !== "success" && value.status !== "error") {
    return undefined;
  }
  if (typeof value.durationMs !== "number" || !Number.isFinite(value.durationMs)) {
    return undefined;
  }
  if (typeof value.startedAt !== "string" || typeof value.endedAt !== "string") {
    return undefined;
  }
  if (!Array.isArray(value.events)) {
    return undefined;
  }
  return value as StudioToolRunResponse;
}

function displayToolRunValue(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }
  const parsed = parseToolDisplayValue(value);
  return parsed.kind === "json" ? parsed.value : value;
}

function formatSchema(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
