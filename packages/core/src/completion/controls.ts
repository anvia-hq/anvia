import type {
  CompletionControlValues,
  CompletionModelControls,
  CompletionModelSelectControl,
} from "./types";

export const REASONING_EFFORT_CONTROL_ID = "reasoningEffort";

export type ReasoningEffortControls<Effort extends string = string> = Readonly<{
  reasoningEffort: CompletionModelSelectControl<Effort>;
}>;

export function defineCompletionModelControls<const Controls extends CompletionModelControls>(
  controls: Controls,
): Controls {
  if (typeof controls !== "object" || controls === null || Array.isArray(controls)) {
    throw new TypeError("Completion model controls must be an object.");
  }
  const snapshot: Record<string, CompletionModelSelectControl> = {};
  for (const [id, control] of Object.entries(controls)) {
    if (id.trim().length === 0) {
      throw new TypeError("Completion control ids must not be empty.");
    }
    if (typeof control !== "object" || control === null || Array.isArray(control)) {
      throw new TypeError(`Completion control "${id}" must be an object.`);
    }
    if (control.type !== "select") {
      throw new TypeError(`Completion control "${id}" must have type "select".`);
    }
    if (typeof control.label !== "string" || control.label.trim().length === 0) {
      throw new TypeError(`Completion control "${id}" must have a non-empty label.`);
    }
    if (!Array.isArray(control.options) || control.options.length === 0) {
      throw new TypeError(`Completion control "${id}" must declare at least one option.`);
    }
    const options = control.options.map((option) => {
      if (typeof option !== "string" || option.trim().length === 0) {
        throw new TypeError(`Completion control "${id}" options must not be empty.`);
      }
      return option;
    });
    if (new Set(options).size !== options.length) {
      throw new TypeError(`Completion control "${id}" options must be unique.`);
    }
    if (
      control.defaultValue !== undefined &&
      (typeof control.defaultValue !== "string" || !options.includes(control.defaultValue))
    ) {
      throw new TypeError(
        `Completion control "${id}" defaultValue must be one of its declared options.`,
      );
    }
    if (control.description !== undefined && typeof control.description !== "string") {
      throw new TypeError(`Completion control "${id}" description must be a string.`);
    }
    let next: CompletionModelSelectControl = {
      type: "select",
      label: control.label,
      options: Object.freeze(options),
    };
    if (control.description !== undefined) {
      next = { ...next, description: control.description };
    }
    if (control.defaultValue !== undefined) {
      next = { ...next, defaultValue: control.defaultValue };
    }
    Object.defineProperty(snapshot, id, {
      value: Object.freeze(next),
      enumerable: true,
      configurable: false,
      writable: false,
    });
  }
  return Object.freeze(snapshot) as Controls;
}

export function mergeCompletionControlValues<Controls extends CompletionModelControls>(
  defaults: CompletionControlValues<Controls> | undefined,
  overrides: CompletionControlValues<Controls> | undefined,
): Readonly<Record<string, string>> | undefined {
  if (defaults === undefined && overrides === undefined) return undefined;
  const values: Record<string, string> = {};
  for (const source of [defaults, overrides]) {
    for (const [id, value] of Object.entries(source ?? {})) {
      if (typeof value !== "string") continue;
      Object.defineProperty(values, id, {
        value,
        enumerable: true,
        configurable: true,
        writable: true,
      });
    }
  }
  return Object.keys(values).length === 0 ? undefined : Object.freeze(values);
}
