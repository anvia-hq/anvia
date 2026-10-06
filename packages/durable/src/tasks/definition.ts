import { json, nonblank, sameJson } from "../json.js";
import type {
  DefinedTask,
  RegisteredTask,
  TaskContext,
  TaskDefinition,
  TaskTransition,
} from "./types.js";
import type { JsonValue } from "@anvia/core/completion";
import type { z } from "zod";
import { taskKey } from "./state.js";

export function defineTask<I, S, R>(definition: TaskDefinition<I, S, R>): DefinedTask<I, S, R> {
  return { ...definition, registration: registerTask(definition) };
}

export function registerTask<I, S, R>(task: TaskDefinition<I, S, R>): RegisteredTask {
  nonblank(task.name, "Task name");
  taskKey(task.name);
  if (!Number.isSafeInteger(task.version) || task.version < 1)
    throw new TypeError("Task version must be a positive integer.");
  const parse = (schema: z.ZodType, value: unknown): JsonValue => {
    const result = json(schema.parse(json(value)));
    if (!sameJson(result, schema.parse(json(result))))
      throw new TypeError("Task schemas must round-trip persisted JSON without changing it.");
    return result;
  };
  const input = (value: unknown) => parse(task.input, value);
  const checkpoint = (value: unknown) => parse(task.checkpoint, value);
  return {
    name: task.name,
    version: task.version,
    parseInput: input,
    parseCheckpoint: checkpoint,
    parseOutput: (value) => parse(task.output, value),
    initial: (value) => checkpoint(task.initial(value as I)),
    // Both values came through the registered schemas before this invocation.
    run: async (context) =>
      (await task.run(context as unknown as TaskContext<I, S>)) as TaskTransition<
        JsonValue,
        JsonValue
      >,
    ...(task.migrate === undefined
      ? {}
      : {
          migrate: (value, state, version) => {
            const result = task.migrate!(value, state, version);
            return { input: input(result.input), checkpoint: checkpoint(result.checkpoint) };
          },
        }),
  };
}
