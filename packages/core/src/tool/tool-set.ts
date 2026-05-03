import type { ToolDefinition } from "../completion/types";
import { ToolCallError, ToolJsonError, ToolNotFoundError } from "./errors";
import { type AnyTool, parseToolArgs, serializeToolOutput } from "./tool";

export class ToolSet {
  private readonly tools = new Map<string, AnyTool>();

  static fromTools(tools: AnyTool[]): ToolSet {
    const toolSet = new ToolSet();
    for (const tool of tools) {
      toolSet.addTool(tool);
    }
    return toolSet;
  }

  addTool(tool: AnyTool): this {
    this.tools.set(tool.name, tool);
    return this;
  }

  addTools(tools: AnyTool[] | ToolSet): this {
    const values = Array.isArray(tools) ? tools : tools.values();
    for (const tool of values) {
      this.addTool(tool);
    }
    return this;
  }

  deleteTool(toolName: string): boolean {
    return this.tools.delete(toolName);
  }

  contains(toolName: string): boolean {
    return this.tools.has(toolName);
  }

  get(toolName: string): AnyTool | undefined {
    return this.tools.get(toolName);
  }

  values(): AnyTool[] {
    return [...this.tools.values()];
  }

  async getToolDefinitions(prompt = ""): Promise<ToolDefinition[]> {
    const defs: ToolDefinition[] = [];
    for (const tool of this.tools.values()) {
      defs.push(await tool.definition(prompt));
    }
    return defs;
  }

  async call(toolName: string, args: string): Promise<string> {
    const tool = this.tools.get(toolName);
    if (tool === undefined) {
      throw new ToolNotFoundError(toolName);
    }

    let parsedArgs: unknown;
    try {
      parsedArgs = parseToolArgs(args);
    } catch (error) {
      throw new ToolJsonError(`Invalid JSON arguments for tool ${toolName}`, error);
    }

    try {
      const output = await tool.call(parsedArgs);
      return serializeToolOutput(output);
    } catch (error) {
      if (error instanceof Error) {
        throw new ToolCallError(error.message, error);
      }
      throw new ToolCallError(`Tool ${toolName} failed`, error);
    }
  }
}
