import { Agent } from "@anvia/core/agent";
import { randomUUID } from "node:crypto";
import { realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, sep } from "node:path";
import { AcpError } from "./errors.js";
import { resolveLimits } from "./limits.js";
import { validateTurnBudget } from "./turn-budget.js";
import { AcpSession } from "./session.js";
import type {
  AcpClientCapabilities,
  AcpLimits,
  AcpOptions,
  AcpSessionBinding,
  AcpSessionContext,
  AcpSessionFactory,
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
  private closing: Promise<void> | undefined;
  private closed = false;

  constructor(options: AcpOptions) {
    this.limits = resolveLimits(options.limits);
    this.factory = options.sessionFactory;
    this.roots = options.workspaceRoots && [...options.workspaceRoots];
    this.images = options.images ?? false;
    this.reasoning = options.reasoning ?? false;
  }

  create(cwd: string, capabilities: AcpClientCapabilities): Promise<string> {
    if (this.closed) return Promise.reject(new AcpError("connection_closed"));
    if (this.sessions.size + this.setups.size >= this.limits.maxSessions) {
      return Promise.reject(new AcpError("resource_limit"));
    }
    const controller = new AbortController();
    const setup = this.setup(cwd, capabilities, controller).finally(() => {
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

  private async setup(
    cwd: string,
    capabilities: AcpClientCapabilities,
    controller: AbortController,
  ): Promise<string> {
    let binding: AcpSessionBinding | undefined;
    try {
      const canonicalCwd = await directory(cwd);
      const roots = this.roots ? await Promise.all(this.roots.map(directory)) : [canonicalCwd];
      if (!roots.some((root) => contains(root, canonicalCwd))) throw new AcpError("policy_denied");
      if (this.closed) throw new AcpError("connection_closed");
      const context: AcpSessionContext = Object.freeze({
        sessionId: randomUUID(),
        cwd: canonicalCwd,
        clientCapabilities: Object.freeze({ ...capabilities }),
        policy: Object.freeze({
          permissionPreset: "ask",
          workspaceRoots: Object.freeze(roots),
          editorTools: Object.freeze({
            readTextFile: false,
            writeTextFile: false,
            terminal: false,
          }),
        }),
        mcpServers: Object.freeze([]),
        editorTools: Object.freeze([]),
        signal: controller.signal,
      });
      const result = await this.factory(context);
      // Never dispose a reused agent: the first session still owns its resources.
      if (result?.agent instanceof Agent && this.agents.has(result.agent)) {
        throw new AcpError("configuration_error");
      }
      binding = result;
      if (
        !(binding?.agent instanceof Agent) ||
        (binding.dispose !== undefined && typeof binding.dispose !== "function") ||
        (binding.toolPresentation !== undefined && typeof binding.toolPresentation !== "function")
      ) {
        throw new AcpError("configuration_error");
      }
      validateTurnBudget(binding.turnBudget);
      this.agents.add(binding.agent);
      if (this.closed) throw new AcpError("connection_closed");
      if (
        binding.agent.memory !== undefined ||
        binding.agent.outputSchema !== undefined ||
        (this.images && !binding.agent.model.capabilities.imageInput)
      ) {
        throw new AcpError("configuration_error");
      }
      const session = new AcpSession(
        context,
        binding,
        controller,
        this.limits,
        this.images,
        this.reasoning,
      );
      this.sessions.set(context.sessionId, session);
      return context.sessionId;
    } catch (error) {
      controller.abort();
      try {
        if (typeof binding?.dispose === "function") await binding.dispose();
      } catch {
        // Preserve the original safe setup failure after attempting cleanup.
      }
      if (this.closed) throw new AcpError("connection_closed");
      if (error instanceof AcpError) throw error;
      throw new AcpError("configuration_error");
    }
  }
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
