import type { JsonObject } from "../completion/index";
import type { AnyTool } from "../tool/index";

export type McpServerInfo = {
  readonly name: string;
  readonly version: string;
  readonly title?: string | undefined;
  readonly description?: string | undefined;
  readonly websiteUrl?: string | undefined;
  readonly icons?: readonly {
    readonly src: string;
    readonly mimeType?: string | undefined;
    readonly sizes?: readonly string[] | undefined;
    readonly theme?: "light" | "dark" | undefined;
  }[];
};

export type McpTool = AnyTool & {
  readonly mcp: {
    readonly serverName: string;
    readonly remoteName: string;
  };
};

export type McpServer = {
  readonly name: string;
  readonly tools: readonly McpTool[];
  readonly serverInfo?: McpServerInfo | undefined;
  readonly capabilities?: JsonObject | undefined;
  readonly instructions?: string | undefined;
};
