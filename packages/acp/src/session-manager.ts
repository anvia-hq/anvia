import { SessionConfiguration } from "./config.js";
import { createEditorTools, editorPresentation, type EditorClient } from "./editor-tools.js";
import { Agent } from "@anvia/core/agent";
import { randomUUID } from "node:crypto";
import { realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, sep } from "node:path";
import { AcpError } from "./errors.js";
import { resolveLimits } from "./limits.js";
import { validateTurnBudget } from "./turn-budget.js";
import { AcpSession } from "./session.js";
import {
  assertMcpRegistration,
  connectSessionMcp,
  snapshotMcpOptions,
  type McpDeclaration,
} from "./mcp.js";
import type { McpClientGroup } from "@anvia/mcp";
import type {
  AcpClientCapabilities,
  AcpLimits,
  AcpMcpOptions,
  AcpOptions,
  AcpSessionBinding,
  AcpSessionContext,
  AcpSessionFactory,
  AcpSessionConfig,
} from "./types.js";

export class SessionManager {
  readonly limits: AcpLimits;
  private readonly sessions = new Map<string, AcpSession>();
  private readonly setups = new Map<AbortController, Promise<string>>();
  private readonly agents = new WeakSet<Agent>();
  private readonly factory: AcpSessionFactory;
  private readonly roots: readonly string[] | undefined;
  private readonly images: boolean;
  private readonly reasoning: boolean;
  readonly configuration: SessionConfiguration;
  private readonly editorTools: AcpOptions["editorTools"];
  private readonly embeddedContext: boolean;
  private readonly mcp: AcpMcpOptions;
  private closing: Promise<void> | undefined;
  private closed = false;

  constructor(options: AcpOptions) {
    this.configuration = new SessionConfiguration(options);
    this.editorTools = Object.freeze({ ...options.editorTools });
    this.embeddedContext = options.embeddedContext === true;
    this.limits = resolveLimits(options.limits);
    this.factory = options.sessionFactory;
    this.roots = options.workspaceRoots && [...options.workspaceRoots];
    this.images = options.images ?? false;
    this.reasoning = options.reasoning ?? false;
    this.mcp = snapshotMcpOptions(options.mcp);
  }

  get supportsHttpMcp(): boolean {
    return this.mcp.http === true;
  }

  create(
    cwd: string,
    capabilities: AcpClientCapabilities,
    declarations: readonly McpDeclaration[] = [],
    editor?: (sessionId: string) => EditorClient,
  ): Promise<string> {
    if (this.closed) return Promise.reject(new AcpError("connection_closed"));
    if (this.sessions.size + this.setups.size >= this.limits.maxSessions) {
      return Promise.reject(new AcpError("resource_limit"));
    }
    const controller = new AbortController();
    const setup = this.setup(
      cwd,
      Object.freeze({ ...capabilities }),
      controller,
      structuredClone(declarations),
      editor,
    ).finally(() => {
      this.setups.delete(controller);
    });
    this.setups.set(controller, setup);
    return setup;
  }

  get(sessionId: string): AcpSession {
    if (this.closed) throw new AcpError("connection_closed");
    const session = this.sessions.get(sessionId);
    if (!session) throw new AcpError("session_not_found");
    return session;
  }

  cancel(sessionId: string): void {
    this.sessions.get(sessionId)?.cancel();
  }

  close(): Promise<void> {
    if (!this.closing) {
      this.closed = true;
      for (const controller of this.setups.keys()) controller.abort();
      const cleanup = [...this.sessions.values()].map((session) => session.close());
      this.sessions.clear();
      this.closing = Promise.allSettled([...cleanup, ...this.setups.values()]).then(
        () => undefined,
      );
    }
    return this.closing;
  }

  private async bind(context: AcpSessionContext): Promise<AcpSessionBinding> {
    let binding: AcpSessionBinding | undefined;
    try {
      const result = await this.factory(context);
      // A reused agent remains owned by its original binding.
      if (result?.agent instanceof Agent && this.agents.has(result.agent))
        throw new AcpError("configuration_error");
      binding = result;
      if (
        !(binding?.agent instanceof Agent) ||
        (binding.dispose !== undefined && typeof binding.dispose !== "function") ||
        (binding.toolPresentation !== undefined && typeof binding.toolPresentation !== "function")
      )
        throw new AcpError("configuration_error");
      const agent = binding.agent;
      this.agents.add(agent);
      validateTurnBudget(binding.turnBudget);
      assertMcpRegistration(agent, context.mcpServers);
      if (context.editorTools.some((tool) => !agent.tools.includes(tool)))
        throw new AcpError("configuration_error");
      if (context.config.mode === "read-only") {
        const reads = new Set(binding.readOnlyTools ?? []);
        if (
          agent.mcpServers.length ||
          agent.tools.some((tool) => !context.editorTools.includes(tool) && !reads.has(tool.name))
        )
          throw new AcpError("configuration_error");
      }
      if (
        agent.memory !== undefined ||
        agent.outputSchema !== undefined ||
        (this.images && !agent.model.capabilities.imageInput)
      )
        throw new AcpError("configuration_error");
      if (this.closed || context.signal.aborted) throw new AcpError("connection_closed");
      const presentation = binding.toolPresentation;
      return {
        ...binding,
        toolPresentation: (call) =>
          editorPresentation(call, context.editorTools, context.cwd) ?? presentation?.(call),
      };
    } catch (error) {
      try {
        await disposeResources(binding);
      } catch {
        /* Preserve the setup error. */
      }
      if (this.closed || context.signal.aborted) throw new AcpError("connection_closed");
      if (error instanceof AcpError) throw error;
      throw new AcpError("configuration_error");
    }
  }

  private async setup(
    cwd: string,
    capabilities: AcpClientCapabilities,
    controller: AbortController,
    declarations: readonly McpDeclaration[],
    editor?: (sessionId: string) => EditorClient,
  ): Promise<string> {
    let binding: AcpSessionBinding | undefined;
    let mcp: McpClientGroup | undefined;
    try {
      const canonicalCwd = await directory(cwd);
      const roots = this.roots ? await Promise.all(this.roots.map(directory)) : [canonicalCwd];
      if (!roots.some((root) => contains(root, canonicalCwd))) throw new AcpError("policy_denied");
      if (this.closed) throw new AcpError("connection_closed");
      const connected = await connectSessionMcp(
        declarations,
        this.mcp,
        canonicalCwd,
        controller.signal,
      );
      mcp = connected.group;
      if (this.closed) throw new AcpError("connection_closed");
      const sessionId = randomUUID();
      const client = editor?.(sessionId);
      let session: AcpSession | undefined;
      const build = async (config: AcpSessionConfig) => {
        const readOnly = config.mode === "read-only";
        const policy = Object.freeze({
          permissionPreset: config.mode,
          workspaceRoots: Object.freeze(roots),
          editorTools: Object.freeze({
            readTextFile:
              !!client && this.editorTools?.readTextFile === true && capabilities.readTextFile,
            writeTextFile:
              !!client &&
              !readOnly &&
              this.editorTools?.writeTextFile === true &&
              capabilities.writeTextFile,
            terminal:
              !!client && !readOnly && this.editorTools?.terminal === true && capabilities.terminal,
          }),
        });
        const tools = createEditorTools(canonicalCwd, policy, client, () => {
          if (!session) throw new AcpError("configuration_error");
          return session.pendingRequests;
        });
        const context: AcpSessionContext = Object.freeze({
          sessionId,
          cwd: canonicalCwd,
          clientCapabilities: Object.freeze({ ...capabilities }),
          policy,
          config,
          mcpServers: readOnly ? Object.freeze([]) : connected.servers,
          editorTools: tools,
          signal: controller.signal,
        });
        return { context, binding: await this.bind(context) };
      };
      const initial = await build(this.configuration.initial());
      binding = initial.binding;
      if (this.closed || controller.signal.aborted) throw new AcpError("connection_closed");
      session = new AcpSession(
        initial.context,
        binding,
        controller,
        this.limits,
        this.images,
        this.reasoning,
        {
          configuration: this.configuration,
          embeddedContext: this.embeddedContext,
          rebuild: build,
          cleanup: () => disposeResources(undefined, mcp),
        },
      );
      this.sessions.set(sessionId, session);
      return sessionId;
    } catch (error) {
      controller.abort();
      try {
        await disposeResources(binding, mcp);
      } catch {
        // Preserve the original safe setup failure after attempting cleanup.
      }
      if (this.closed) throw new AcpError("connection_closed");
      if (error instanceof AcpError) throw error;
      throw new AcpError("configuration_error");
    }
  }
}

async function disposeResources(binding?: AcpSessionBinding, mcp?: McpClientGroup): Promise<void> {
  const results = await Promise.allSettled([
    Promise.resolve().then(() => mcp?.close()),
    Promise.resolve().then(() => {
      if (typeof binding?.dispose === "function") return binding.dispose();
    }),
  ]);
  const errors = results.flatMap((result) => (result.status === "rejected" ? [result.reason] : []));
  if (errors.length) throw new AggregateError(errors, "Session cleanup failed");
}

async function directory(path: string): Promise<string> {
  try {
    if (!isAbsolute(path)) throw new AcpError("invalid_cwd");
    const canonical = await realpath(path);
    if (!(await stat(canonical)).isDirectory()) throw new AcpError("invalid_cwd");
    return canonical;
  } catch {
    throw new AcpError("invalid_cwd");
  }
}

function contains(root: string, cwd: string): boolean {
  const path = relative(root, cwd);
  return path === "" || (path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path));
}
