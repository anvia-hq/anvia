import { createTool, createToolkit, type Toolkit, type ToolkitOptions } from "@anvia/core/tool";
import { z } from "zod";

export type TodoStatus = "pending" | "in_progress" | "completed" | "cancelled";

export type TodoItem = {
  id: string;
  content: string;
  status: TodoStatus;
};

export interface TodoStore {
  get(): readonly TodoItem[] | Promise<readonly TodoItem[]>;
  set(items: readonly TodoItem[]): void | Promise<void>;
}

export class InMemoryTodoStore implements TodoStore {
  private items: TodoItem[] = [];

  constructor(initial: readonly TodoItem[] = []) {
    this.items = initial.map((item) => ({ ...item }));
  }

  get(): readonly TodoItem[] {
    return this.items.map((item) => ({ ...item }));
  }

  set(items: readonly TodoItem[]): void {
    this.items = items.map((item) => ({ ...item }));
  }
}

export type TodoToolName = "todo_read" | "todo_write";

export type TodoOptions = ToolkitOptions<TodoToolName> & {
  store?: TodoStore | undefined;
  /** Maximum number of todo items allowed. Default 50. */
  maxItems?: number | undefined;
};

const todoItemSchema = z.object({
  id: z.string().trim().min(1).describe("Stable short identifier for the task."),
  content: z.string().trim().min(1).describe("Clear description of the task."),
  status: z.enum(["pending", "in_progress", "completed", "cancelled"]),
});

const DEFAULT_INSTRUCTIONS =
  "Use todo_write and todo_read to track multi-step work. Keep at most one task in_progress at a time and update statuses as steps finish.";

export function todo(options: TodoOptions = {}): Toolkit {
  const store = options.store ?? new InMemoryTodoStore();
  const maxItems = options.maxItems ?? 50;

  if (!Number.isSafeInteger(maxItems) || maxItems <= 0) {
    throw new RangeError("todo maxItems must be a positive safe integer.");
  }

  const readTool = createTool({
    name: "todo_read",
    description: "Read the current task list.",
    inputSchema: z.object({}),
    handler: async () => {
      const items = await store.get();
      return {
        count: items.length,
        items: items.map((item) => ({ ...item })),
      };
    },
  });

  const writeTool = createTool({
    name: "todo_write",
    description: "Replace the current task list with an updated ordered list of tasks.",
    inputSchema: z.object({
      items: z.array(todoItemSchema).max(maxItems).describe("The full updated ordered task list."),
    }),
    handler: async (args) => {
      const seen = new Set<string>();
      for (const item of args.items) {
        if (seen.has(item.id)) {
          throw new Error(`Duplicate todo item id "${item.id}".`);
        }

        seen.add(item.id);
      }

      await store.set(args.items);
      return {
        count: args.items.length,
        items: args.items.map((item) => ({ ...item })),
      };
    },
  });

  return createToolkit<TodoToolName>(
    {
      name: "todo",
      tools: [readTool, writeTool],
      instructions: DEFAULT_INSTRUCTIONS,
    },
    options,
  );
}
