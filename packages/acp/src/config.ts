import { AcpError } from "./errors.js";
import type { AcpCommand, AcpOptions, AcpSessionConfig } from "./types.js";

export class SessionConfiguration {
  readonly models: readonly Readonly<{ value: string; name: string }>[];
  readonly commands: readonly AcpCommand[];
  readonly readOnly: boolean;

  constructor(options: AcpOptions) {
    this.models = Object.freeze((options.models ?? []).map((model) => Object.freeze({ ...model })));
    this.commands = Object.freeze(
      (options.commands ?? []).map((command) => Object.freeze({ ...command })),
    );
    this.readOnly = options.readOnlyMode === true;
    if (
      new Set(this.models.map((model) => model.value)).size !== this.models.length ||
      this.models.some((model) => !model.value || !model.name) ||
      new Set(this.commands.map((command) => command.name)).size !== this.commands.length ||
      this.commands.some(
        (command) =>
          !/^[a-z][a-z0-9_-]*$/.test(command.name) ||
          !command.description ||
          typeof command.expand !== "function",
      )
    ) {
      throw new AcpError("configuration_error");
    }
  }

  initial(): AcpSessionConfig {
    const config: { mode: "ask"; model?: string } = { mode: "ask" };
    if (this.models[0]) config.model = this.models[0].value;
    return Object.freeze(config);
  }

  change(config: AcpSessionConfig, id: string, value: unknown): AcpSessionConfig {
    if (id === "mode" && (value === "ask" || (value === "read-only" && this.readOnly))) {
      return Object.freeze({ ...config, mode: value });
    }
    if (
      id === "model" &&
      typeof value === "string" &&
      this.models.some((model) => model.value === value)
    ) {
      return Object.freeze({ ...config, model: value });
    }
    throw new AcpError("invalid_config");
  }

  options(config: AcpSessionConfig) {
    const options = [
      {
        id: "mode",
        name: "Mode",
        category: "mode",
        type: "select" as const,
        currentValue: config.mode as string,
        options: [
          { value: "ask", name: "Ask" },
          ...(this.readOnly ? [{ value: "read-only", name: "Read only" }] : []),
        ],
      },
    ];
    if (config.model !== undefined)
      options.push({
        id: "model",
        name: "Model",
        category: "model",
        type: "select",
        currentValue: config.model,
        options: this.models.map((model) => ({ ...model })),
      });
    return options;
  }
}
