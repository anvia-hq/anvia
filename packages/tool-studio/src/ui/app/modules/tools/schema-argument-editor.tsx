import { useEffect, useMemo, useState } from "react";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/select";
import { Textarea } from "../../components/ui/textarea";
import { isRecord } from "../shared/object";

type ArgumentMode = "form" | "json";
type JsonPath = Array<string | number>;
type ParseResult = { ok: true; value: unknown } | { ok: false; error: string };

export function SchemaArgumentEditor(props: {
  schema: unknown;
  value: string;
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  const [mode, setMode] = useState<ArgumentMode>("form");
  const rootFields = useMemo(() => schemaFields(props.schema), [props.schema]);
  const parsed = useMemo(() => parseJson(props.value), [props.value]);
  const disabled = props.disabled === true;
  const canRenderForm = rootFields.length > 0;
  const effectiveMode = canRenderForm ? mode : "json";
  const rootValue = parsed.ok && isRecord(parsed.value) ? parsed.value : undefined;

  function updatePath(path: JsonPath, value: unknown | undefined) {
    const base = rootValue ?? {};
    props.onChange(formatEditorJson(setValueAtPath(base, path, value)));
  }

  function removePathItem(path: JsonPath, index: number) {
    const base = rootValue ?? {};
    const arrayValue = getValueAtPath(base, path);
    if (!Array.isArray(arrayValue)) {
      return;
    }
    props.onChange(
      formatEditorJson(
        setValueAtPath(
          base,
          path,
          arrayValue.filter((_, itemIndex) => itemIndex !== index),
        ),
      ),
    );
  }

  return (
    <div className="grid min-w-0 gap-3">
      <div className="flex min-w-0 items-center justify-between gap-3">
        <span className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
          Arguments
        </span>
        {canRenderForm ? (
          <div className="inline-grid h-8 grid-cols-2 overflow-hidden rounded-md border border-border/80 bg-background/45 p-0.5">
            <ModeButton active={effectiveMode === "form"} onClick={() => setMode("form")}>
              Form
            </ModeButton>
            <ModeButton active={effectiveMode === "json"} onClick={() => setMode("json")}>
              JSON
            </ModeButton>
          </div>
        ) : (
          <span className="text-xs font-medium text-muted-foreground">JSON</span>
        )}
      </div>

      {effectiveMode === "json" || rootValue === undefined ? (
        <RawJsonEditor
          disabled={disabled}
          error={parsed.ok ? "" : parsed.error}
          value={props.value}
          onChange={props.onChange}
        />
      ) : (
        <div className="grid gap-3">
          {rootFields.map((field) => (
            <SchemaField
              disabled={disabled}
              field={field}
              key={field.name}
              path={[field.name]}
              rootValue={rootValue}
              onChange={updatePath}
              onRemoveArrayItem={removePathItem}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ModeButton(props: { active: boolean; children: string; onClick: () => void }) {
  return (
    <button
      className={
        props.active
          ? "rounded-[5px] bg-muted/55 px-3 text-xs font-semibold text-foreground"
          : "rounded-[5px] px-3 text-xs font-medium text-muted-foreground transition hover:text-foreground"
      }
      type="button"
      onClick={props.onClick}
    >
      {props.children}
    </button>
  );
}

function RawJsonEditor(props: {
  value: string;
  error: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <div className="grid gap-2">
      <Textarea
        className="min-h-36 resize-y rounded-md border-border bg-background/45 p-3 text-xs leading-5"
        disabled={props.disabled}
        value={props.value}
        spellCheck={false}
        onChange={(event) => props.onChange(event.target.value)}
      />
      {props.error.length === 0 ? null : (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs leading-5 text-destructive">
          {props.error}
        </div>
      )}
    </div>
  );
}

type SchemaFieldDefinition = {
  name: string;
  schema: Record<string, unknown>;
  required: boolean;
};

function SchemaField(props: {
  field: SchemaFieldDefinition;
  path: JsonPath;
  rootValue: Record<string, unknown>;
  disabled: boolean;
  onChange: (path: JsonPath, value: unknown | undefined) => void;
  onRemoveArrayItem: (path: JsonPath, index: number) => void;
}) {
  const value = getValueAtPath(props.rootValue, props.path);
  const label = schemaLabel(props.field.schema, props.field.name);
  const description = schemaDescription(props.field.schema);
  const type = schemaPrimaryType(props.field.schema);

  if (type === "object") {
    const fields = schemaFields(props.field.schema);
    return (
      <fieldset className="grid min-w-0 gap-3 border-b border-border/70 pb-3 last:border-b-0">
        <div className="flex min-w-0 items-center justify-between gap-3">
          <legend className="min-w-0 truncate text-sm font-semibold text-foreground">
            {label}
          </legend>
          {props.field.required ? <RequiredBadge /> : null}
        </div>
        {description === undefined ? null : (
          <p className="m-0 text-xs leading-5 text-muted-foreground">{description}</p>
        )}
        {fields.length === 0 ? (
          <JsonValueField
            disabled={props.disabled}
            path={props.path}
            value={value}
            onChange={props.onChange}
          />
        ) : (
          <div className="grid gap-3 border-l border-border/70 pl-3">
            {fields.map((field) => (
              <SchemaField
                disabled={props.disabled}
                field={field}
                key={field.name}
                path={[...props.path, field.name]}
                rootValue={props.rootValue}
                onChange={props.onChange}
                onRemoveArrayItem={props.onRemoveArrayItem}
              />
            ))}
          </div>
        )}
      </fieldset>
    );
  }

  if (type === "array") {
    return (
      <ArrayField
        description={description}
        disabled={props.disabled}
        field={props.field}
        label={label}
        path={props.path}
        rootValue={props.rootValue}
        value={value}
        onChange={props.onChange}
        onRemoveArrayItem={props.onRemoveArrayItem}
      />
    );
  }

  return (
    <div className="grid min-w-0 gap-2 border-b border-border/70 pb-3 last:border-b-0">
      <FieldHeader label={label} required={props.field.required} />
      {description === undefined ? null : (
        <p className="m-0 text-xs leading-5 text-muted-foreground">{description}</p>
      )}
      <ScalarFieldControl
        disabled={props.disabled}
        path={props.path}
        required={props.field.required}
        schema={props.field.schema}
        value={value}
        onChange={props.onChange}
      />
    </div>
  );
}

function ArrayField(props: {
  field: SchemaFieldDefinition;
  label: string;
  description: string | undefined;
  path: JsonPath;
  rootValue: Record<string, unknown>;
  value: unknown;
  disabled: boolean;
  onChange: (path: JsonPath, value: unknown | undefined) => void;
  onRemoveArrayItem: (path: JsonPath, index: number) => void;
}) {
  const itemSchema = schemaItems(props.field.schema);
  const items = Array.isArray(props.value) ? props.value : [];
  const itemEntries = items.map((item, index) => ({
    index,
    key: `${formatPath(props.path)}:${index}:${formatEnumValue(item)}`,
  }));
  return (
    <div className="grid min-w-0 gap-3 border-b border-border/70 pb-3 last:border-b-0">
      <div className="flex min-w-0 items-center justify-between gap-3">
        <FieldHeader label={props.label} required={props.field.required} />
        {itemSchema === undefined ? null : (
          <Button
            className="h-8 min-h-8 rounded-md px-3 text-xs"
            disabled={props.disabled}
            type="button"
            variant="secondary"
            onClick={() =>
              props.onChange(props.path, [...items, defaultValueForSchema(itemSchema)])
            }
          >
            Add
          </Button>
        )}
      </div>
      {props.description === undefined ? null : (
        <p className="m-0 text-xs leading-5 text-muted-foreground">{props.description}</p>
      )}
      {itemSchema === undefined ? (
        <JsonValueField
          disabled={props.disabled}
          path={props.path}
          value={props.value}
          onChange={props.onChange}
        />
      ) : items.length === 0 ? (
        <div className="rounded-md border border-dashed border-border/70 px-3 py-2 text-xs text-muted-foreground">
          Empty array
        </div>
      ) : (
        <div className="grid gap-3 border-l border-border/70 pl-3">
          {itemEntries.map((item) => (
            <div className="grid gap-2" key={item.key}>
              <div className="flex items-center justify-between gap-3">
                <span className="text-xs font-medium text-muted-foreground">
                  Item {item.index + 1}
                </span>
                <Button
                  className="h-7 min-h-7 rounded-md px-2 text-xs"
                  disabled={props.disabled}
                  type="button"
                  variant="ghost"
                  onClick={() => props.onRemoveArrayItem(props.path, item.index)}
                >
                  Remove
                </Button>
              </div>
              <SchemaField
                disabled={props.disabled}
                field={{
                  name: String(item.index + 1),
                  required: true,
                  schema: itemSchema,
                }}
                path={[...props.path, item.index]}
                rootValue={props.rootValue}
                onChange={props.onChange}
                onRemoveArrayItem={props.onRemoveArrayItem}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function FieldHeader(props: { label: string; required: boolean }) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <span className="min-w-0 truncate text-sm font-semibold text-foreground">{props.label}</span>
      {props.required ? <RequiredBadge /> : null}
    </div>
  );
}

function RequiredBadge() {
  return (
    <span className="rounded-md bg-muted/35 px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
      required
    </span>
  );
}

function ScalarFieldControl(props: {
  schema: Record<string, unknown>;
  path: JsonPath;
  value: unknown;
  required: boolean;
  disabled: boolean;
  onChange: (path: JsonPath, value: unknown | undefined) => void;
}) {
  const enumOptions = schemaEnum(props.schema);
  if (enumOptions.length > 0) {
    const selectedIndex = enumOptions.findIndex((option) => jsonEqual(option, props.value));
    const optionEntries = enumOptions.map((option, index) => ({
      label: formatEnumValue(option),
      value: String(index),
      key: `${index}:${formatEnumValue(option)}`,
    }));
    return (
      <div className="flex min-w-0 items-center gap-2">
        <Select
          value={selectedIndex === -1 ? "" : String(selectedIndex)}
          disabled={props.disabled}
          onValueChange={(value) => props.onChange(props.path, enumOptions[Number(value)])}
        >
          <SelectTrigger className="h-9 min-h-9 rounded-md border-border bg-background/45 text-sm">
            <SelectValue placeholder="Select value" />
          </SelectTrigger>
          <SelectContent>
            {optionEntries.map((option) => (
              <SelectItem value={option.value} key={option.key}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {selectedIndex === -1 || props.required ? null : (
          <Button
            className="h-9 min-h-9 rounded-md px-3 text-xs"
            disabled={props.disabled}
            type="button"
            variant="ghost"
            onClick={() => props.onChange(props.path, undefined)}
          >
            Clear
          </Button>
        )}
      </div>
    );
  }

  const type = schemaPrimaryType(props.schema);
  if (type === "boolean") {
    return (
      <label className="flex min-h-9 w-fit cursor-pointer items-center gap-2 rounded-md border border-border/70 bg-background/45 px-3 text-sm text-foreground">
        <input
          checked={props.value === true}
          disabled={props.disabled}
          type="checkbox"
          className="h-4 w-4 accent-foreground"
          onChange={(event) => props.onChange(props.path, event.target.checked)}
        />
        Enabled
      </label>
    );
  }

  if (type === "number" || type === "integer") {
    return (
      <NumberFieldControl
        disabled={props.disabled}
        path={props.path}
        schema={props.schema}
        type={type}
        value={props.value}
        onChange={props.onChange}
      />
    );
  }

  if (type === "string") {
    return (
      <Input
        className="h-9 rounded-md border-border bg-background/45 text-sm"
        disabled={props.disabled}
        type="text"
        value={typeof props.value === "string" ? props.value : ""}
        placeholder={schemaDefaultPlaceholder(props.schema)}
        onChange={(event) => {
          const nextValue = event.target.value;
          props.onChange(
            props.path,
            nextValue.length === 0 && !props.required ? undefined : nextValue,
          );
        }}
      />
    );
  }

  return (
    <JsonValueField
      disabled={props.disabled}
      path={props.path}
      value={props.value}
      onChange={props.onChange}
    />
  );
}

function NumberFieldControl(props: {
  schema: Record<string, unknown>;
  type: "number" | "integer";
  path: JsonPath;
  value: unknown;
  disabled: boolean;
  onChange: (path: JsonPath, value: unknown | undefined) => void;
}) {
  const externalValue = typeof props.value === "number" ? String(props.value) : "";
  const [draft, setDraft] = useState(externalValue);

  useEffect(() => {
    setDraft(externalValue);
  }, [externalValue]);

  return (
    <Input
      className="h-9 rounded-md border-border bg-background/45 text-sm"
      disabled={props.disabled}
      inputMode={props.type === "integer" ? "numeric" : "decimal"}
      type="text"
      value={draft}
      placeholder={schemaDefaultPlaceholder(props.schema)}
      onBlur={() => {
        if (draft.trim().length === 0) {
          setDraft("");
          return;
        }
        const nextValue = parseNumberDraft(draft, props.type);
        setDraft(nextValue.ok ? String(nextValue.value) : externalValue);
      }}
      onChange={(event) => {
        const nextDraft = event.target.value;
        setDraft(nextDraft);
        if (nextDraft.trim().length === 0) {
          props.onChange(props.path, undefined);
          return;
        }
        const nextValue = parseNumberDraft(nextDraft, props.type);
        if (nextValue.ok) {
          props.onChange(props.path, nextValue.value);
        }
      }}
    />
  );
}

function JsonValueField(props: {
  path: JsonPath;
  value: unknown;
  disabled: boolean;
  onChange: (path: JsonPath, value: unknown | undefined) => void;
}) {
  const externalValue = useMemo(() => fieldJsonValue(props.value), [props.value]);
  const [draft, setDraft] = useState(externalValue);
  const parsed = useMemo(() => parseJson(draft), [draft]);

  useEffect(() => {
    setDraft(externalValue);
  }, [externalValue]);

  return (
    <div className="grid gap-2">
      <Textarea
        className="min-h-24 resize-y rounded-md border-border bg-background/45 p-3 text-xs leading-5"
        disabled={props.disabled}
        value={draft}
        spellCheck={false}
        onChange={(event) => {
          const nextDraft = event.target.value;
          setDraft(nextDraft);
          if (nextDraft.trim().length === 0) {
            props.onChange(props.path, undefined);
            return;
          }
          const nextValue = parseJson(nextDraft);
          if (nextValue.ok) {
            props.onChange(props.path, nextValue.value);
          }
        }}
      />
      {parsed.ok || draft.trim().length === 0 ? null : (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs leading-5 text-destructive">
          {parsed.error}
        </div>
      )}
    </div>
  );
}

function schemaFields(schema: unknown): SchemaFieldDefinition[] {
  if (!isRecord(schema)) {
    return [];
  }
  const properties = schema.properties;
  if (!isRecord(properties)) {
    return [];
  }
  const required = schemaRequired(schema);
  return Object.entries(properties).map(([name, propertySchema]) => ({
    name,
    required: required.has(name),
    schema: isRecord(propertySchema) ? propertySchema : {},
  }));
}

function schemaRequired(schema: Record<string, unknown>): Set<string> {
  const required = schema.required;
  if (!Array.isArray(required)) {
    return new Set();
  }
  return new Set(required.filter((item): item is string => typeof item === "string"));
}

function schemaPrimaryType(schema: Record<string, unknown>): string {
  const type = schema.type;
  if (typeof type === "string") {
    return type;
  }
  if (Array.isArray(type)) {
    const firstType = type.find(
      (item): item is string => typeof item === "string" && item !== "null",
    );
    if (firstType !== undefined) {
      return firstType;
    }
  }
  if (schemaEnum(schema).length > 0) {
    return "enum";
  }
  if (isRecord(schema.properties)) {
    return "object";
  }
  if (schema.items !== undefined) {
    return "array";
  }
  return "unknown";
}

function schemaItems(schema: Record<string, unknown>): Record<string, unknown> | undefined {
  return isRecord(schema.items) ? schema.items : undefined;
}

function schemaEnum(schema: Record<string, unknown>): unknown[] {
  return Array.isArray(schema.enum) ? schema.enum : [];
}

function schemaLabel(schema: Record<string, unknown>, fallback: string): string {
  return typeof schema.title === "string" && schema.title.length > 0
    ? schema.title
    : formatFieldName(fallback);
}

function schemaDescription(schema: Record<string, unknown>): string | undefined {
  return typeof schema.description === "string" && schema.description.length > 0
    ? schema.description
    : undefined;
}

function schemaDefaultPlaceholder(schema: Record<string, unknown>): string | undefined {
  return Object.hasOwn(schema, "default") ? formatEnumValue(schema.default) : undefined;
}

function defaultValueForSchema(schema: Record<string, unknown>): unknown {
  if (Object.hasOwn(schema, "default")) {
    return schema.default;
  }
  const enumOptions = schemaEnum(schema);
  if (enumOptions.length > 0) {
    return enumOptions[0];
  }
  const type = schemaPrimaryType(schema);
  if (type === "boolean") {
    return false;
  }
  if (type === "integer" || type === "number") {
    return 0;
  }
  if (type === "array") {
    return [];
  }
  if (type === "object") {
    return {};
  }
  if (type === "string") {
    return "";
  }
  return null;
}

function getValueAtPath(root: unknown, path: JsonPath): unknown {
  let current = root;
  for (const segment of path) {
    if (typeof segment === "number") {
      if (!Array.isArray(current)) {
        return undefined;
      }
      current = current[segment];
      continue;
    }
    if (!isRecord(current)) {
      return undefined;
    }
    current = current[segment];
  }
  return current;
}

function setValueAtPath(root: unknown, path: JsonPath, value: unknown | undefined): unknown {
  if (path.length === 0) {
    return value;
  }
  const [segment, ...rest] = path;
  const nextRoot = Array.isArray(root) ? [...root] : isRecord(root) ? { ...root } : {};
  if (rest.length === 0) {
    if (value === undefined) {
      if (Array.isArray(nextRoot) && typeof segment === "number") {
        nextRoot.splice(segment, 1);
      } else if (!Array.isArray(nextRoot) && typeof segment === "string") {
        delete nextRoot[segment];
      }
      return nextRoot;
    }
    if (Array.isArray(nextRoot) && typeof segment === "number") {
      nextRoot[segment] = value;
    } else if (!Array.isArray(nextRoot) && typeof segment === "string") {
      nextRoot[segment] = value;
    }
    return nextRoot;
  }
  const currentValue =
    Array.isArray(nextRoot) && typeof segment === "number"
      ? nextRoot[segment]
      : !Array.isArray(nextRoot) && typeof segment === "string"
        ? nextRoot[segment]
        : undefined;
  const nextValue = setValueAtPath(currentValue, rest, value);
  if (Array.isArray(nextRoot) && typeof segment === "number") {
    nextRoot[segment] = nextValue;
  } else if (!Array.isArray(nextRoot) && typeof segment === "string") {
    nextRoot[segment] = nextValue;
  }
  return nextRoot;
}

function parseJson(value: string): ParseResult {
  if (value.trim().length === 0) {
    return { ok: true, value: undefined };
  }
  try {
    return { ok: true, value: JSON.parse(value) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

type NumberParseResult = { ok: true; value: number } | { ok: false };

function parseNumberDraft(value: string, type: "number" | "integer"): NumberParseResult {
  const normalized = value.trim();
  if (normalized.length === 0 || isIncompleteNumberDraft(normalized)) {
    return { ok: false };
  }
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) {
    return { ok: false };
  }
  if (type === "integer" && !Number.isInteger(parsed)) {
    return { ok: false };
  }
  return { ok: true, value: parsed };
}

function isIncompleteNumberDraft(value: string): boolean {
  return (
    value === "-" ||
    value === "+" ||
    value === "." ||
    value === "-." ||
    value === "+." ||
    /^[+-]?\d+\.$/.test(value) ||
    /[eE][+-]?$/.test(value)
  );
}

function fieldJsonValue(value: unknown): string {
  if (value === undefined) {
    return "";
  }
  return formatEditorJson(value);
}

function formatEditorJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function jsonEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function formatEnumValue(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (value === null) {
    return "null";
  }
  return JSON.stringify(value);
}

function formatPath(path: JsonPath): string {
  return path.join(".");
}

function formatFieldName(value: string): string {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\b\w/g, (match) => match.toUpperCase());
}
