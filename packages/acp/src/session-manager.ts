import { SessionConfiguration } from "./config.js";
import { convertPrompt } from "./content.js";
import { createEditorTools, editorPresentation, type EditorClient } from "./editor-tools.js";
import { Agent } from "@anvia/core/agent";
import { randomUUID } from "node:crypto";
import { realpath, stat } from "node:fs/promises";
import { isAbsolute } from "node:path";
import {
  InMemoryAcpSessionStore,
  contains,
  validateRecord,
  sessionInfo,
  type AcpSessionStore,
  type AcpSessionRecord,
  type AcpSessionPage,
  type AcpSessionQuery,
} from "./session-store.js";
import type { AcpTranscriptEntry } from "./transcript.js";
import { Transcript, assertReplayFits } from "./transcript.js";
import { SessionMemory } from "./memory.js";
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
  private readonly editorRoots: readonly string[];
  private readonly images: boolean;
  private readonly reasoning: boolean;
  readonly configuration: SessionConfiguration;
  private readonly editorTools: AcpOptions["editorTools"];
  private readonly embeddedContext: boolean;
  private readonly mcp: AcpMcpOptions;
  private closing: Promise<void> | undefined;
  private closed = false;
  readonly store: AcpSessionStore;
  private readonly operations = new Map<string, Promise<unknown>>();

  constructor(options: AcpOptions) {
    this.store = options.sessionStore ?? new InMemoryAcpSessionStore();
    this.configuration = new SessionConfiguration(options);
    this.editorTools = Object.freeze({ ...options.editorTools });
    this.embeddedContext = options.embeddedContext === true;
    this.limits = resolveLimits(options.limits);
    this.factory = options.sessionFactory;
    this.roots = options.workspaceRoots && [...options.workspaceRoots];
    this.editorRoots = [...(options.editorWorkspaceRoots ?? [])];
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
    return this.start(cwd, capabilities, declarations, editor);
  }

  restore(
    sessionId: string,
    cwd: string,
    capabilities: AcpClientCapabilities,
    declarations: readonly McpDeclaration[] = [],
    editor?: (sessionId: string) => EditorClient,
    replay?: (entry: AcpTranscriptEntry) => Promise<void>,
  ): Promise<AcpSession> {
    return this.exclusive(sessionId, async () => {
      const existing = this.sessions.get(sessionId);
      if (existing?.busy) throw new AcpError("session_busy");
      const record = await this.stored(sessionId, true);
      if ((await directory(cwd)) !== record.cwd) throw new AcpError("policy_denied");
      if (replay) assertReplayFits(record.transcript, this.limits);
      if (existing) {
        try {
          await existing.close();
        } finally {
          this.sessions.delete(sessionId);
        }
      }
      await this.start(cwd, capabilities, declarations, editor, record);
      const session = this.sessions.get(sessionId);
      if (!session || this.closed) throw new AcpError("connection_closed");
      try {
        if (replay)
          for (const entry of session.transcript()) {
            if (this.closed) throw new AcpError("connection_closed");
            await replay(entry);
          }
        return session;
      } catch (error) {
        await session.close().catch(() => undefined);
        this.sessions.delete(sessionId);
        throw error;
      }
    });
  }

  closeSession(sessionId: string): Promise<void> {
    return this.exclusive(sessionId, async () => {
      const session = this.sessions.get(sessionId);
      if (!session) {
        await this.stored(sessionId);
        return;
      }
      if (!session.durable) await session.cancel();
      try {
        await session.close();
      } finally {
        this.sessions.delete(sessionId);
      }
    });
  }

  deleteSession(sessionId: string): Promise<void> {
    if (!this.store.delete) return Promise.reject(new AcpError("unsupported_session_operation"));
    return this.exclusive(sessionId, async () => {
      try {
        const record = await this.stored(sessionId);
        if (record.pendingRun) throw new AcpError("session_busy");
      } catch (error) {
        if (error instanceof AcpError && error.kind === "session_not_found") return;
        throw error;
      }
      const session = this.sessions.get(sessionId);
      if (session) {
        await session.cancel();
        // Cancellation can retain a completed durable result awaiting its ACP commit.
        // Re-read after settling a turn that may have started during the initial read.
        if ((await this.stored(sessionId)).pendingRun) throw new AcpError("session_busy");
        try {
          await session.close();
        } finally {
          this.sessions.delete(sessionId);
        }
      }
      await this.store.delete!(sessionId);
    });
  }

  async list(cwd?: string, cursor?: string): Promise<AcpSessionPage> {
    if (this.closed) throw new AcpError("connection_closed");
    if (!this.store.list) throw new AcpError("unsupported_session_operation");
    const roots = this.roots ? await Promise.all(this.roots.map(directory)) : undefined;
    const canonical = cwd === undefined ? undefined : await directory(cwd);
    if (canonical && roots && !roots.some((root) => contains(root, canonical)))
      throw new AcpError("policy_denied");
    const query: AcpSessionQuery = { limit: 50 };
    if (canonical !== undefined) query.cwd = canonical;
    if (roots !== undefined) query.workspaceRoots = roots;
    if (cursor !== undefined) query.cursor = cursor;
    const page = await this.store.list(query);
    // Stores are trusted, but never spread their private fields onto the wire.
    const result: AcpSessionPage = {
      sessions: page.sessions
        .filter(
          (entry) =>
            (!canonical || entry.cwd === canonical) &&
            (!roots || roots.some((root) => contains(root, entry.cwd))),
        )
        .map(sessionInfo),
    };
    if (page.nextCursor !== undefined) result.nextCursor = page.nextCursor;
    return result;
  }

  private exclusive<T>(sessionId: string, operation: () => Promise<T>): Promise<T> {
    if (this.closed) return Promise.reject(new AcpError("connection_closed"));
    if (this.operations.has(sessionId)) return Promise.reject(new AcpError("session_busy"));
    if (this.operations.size >= this.limits.maxConcurrentRequests)
      return Promise.reject(new AcpError("resource_limit"));
    const task = Promise.resolve()
      .then(operation)
      .finally(() => this.operations.delete(sessionId));
    this.operations.set(sessionId, task);
    return task;
  }

  private async stored(sessionId: string, restore = false): Promise<AcpSessionRecord> {
    const record = await this.store.get(sessionId);
    if (!record) throw new AcpError("session_not_found");
    validateRecord(record);
    if (record.sessionId !== sessionId) throw new AcpError("configuration_error");
    const cwd = restore ? await directory(record.cwd) : record.cwd;
    if (cwd !== record.cwd) throw new AcpError("policy_denied");
    if (
      this.roots &&
      !(await Promise.all(this.roots.map(directory))).some((root) => contains(root, cwd))
    )
      throw new AcpError("policy_denied");
    if (!restore) return structuredClone(record);
    // Reject removed models/presets before constructing resources or replaying anything.
    this.configuration.change(record.config, "mode", record.config.mode);
    if (record.config.model !== undefined)
      this.configuration.change(record.config, "model", record.config.model);
    const memory = new SessionMemory(sessionId, this.limits, record.messages);
    if (record.pendingRun) {
      convertPrompt(record.pendingRun.blocks, this.limits, this.images, this.embeddedContext);
      memory.assertFits([...record.messages, record.pendingRun.prompt]);
    }
    const transcript = new Transcript(cwd, this.limits.maxHistoryBytes, record.transcript).entries;
    return structuredClone({ ...record, transcript });
  }

  private start(
    cwd: string,
    capabilities: AcpClientCapabilities,
    declarations: readonly McpDeclaration[] = [],
    editor?: (sessionId: string) => EditorClient,
    record?: AcpSessionRecord,
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
      record,
    ).finally(() => {
      this.setups.delete(controller);
    });
    this.setups.set(controller, setup);
    return setup;
  }

  get(sessionId: string): AcpSession {
    if (this.closed) throw new AcpError("connection_closed");
    if (this.operations.has(sessionId)) throw new AcpError("session_busy");
    const session = this.sessions.get(sessionId);
    if (!session) throw new AcpError("session_not_found");
    return session;
  }

  async cancel(sessionId: string): Promise<void> {
    await this.sessions.get(sessionId)?.cancel();
  }

  close(): Promise<void> {
    if (!this.closing) {
      this.closed = true;
      for (const controller of this.setups.keys()) controller.abort();
      const cleanup = [...this.sessions.values()].map((session) => session.close());
      this.sessions.clear();
      this.closing = Promise.allSettled([
        ...cleanup,
        ...this.setups.values(),
        ...this.operations.values(),
      ]).then(() => undefined);
    }
    return this.closing;
  }

  private async bind(context: AcpSessionContext): Promise<AcpSessionBinding> {
    let binding: AcpSessionBinding | undefined;
    try {
      const result = await this.factory(context);
      // A reused agent remains owned by its original binding.
      if (result?.agent instanceof Agent && !result.driver && this.agents.has(result.agent))
        throw new AcpError("configuration_error");
      binding = result;
      if (
        !(binding?.agent instanceof Agent) ||
        (binding.dispose !== undefined && typeof binding.dispose !== "function") ||
        (binding.toolPresentation !== undefined && typeof binding.toolPresentation !== "function")
      )
        throw new AcpError("configuration_error");
      const agent = binding.agent;
      if (
        binding.driver &&
        (!binding.driver.key ||
          typeof binding.driver.execute !== "function" ||
          typeof binding.driver.cancel !== "function" ||
          binding.turnBudget !== undefined ||
          binding.dispose !== undefined ||
          context.editorTools.length > 0 ||
          context.mcpServers.length > 0)
      )
        throw new AcpError("configuration_error");
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
    restored?: AcpSessionRecord,
  ): Promise<string> {
    let binding: AcpSessionBinding | undefined;
    let mcp: McpClientGroup | undefined;
    try {
      const canonicalCwd = await directory(cwd);
      const roots = this.roots ? await Promise.all(this.roots.map(directory)) : [canonicalCwd];
      if (!roots.some((root) => contains(root, canonicalCwd))) throw new AcpError("policy_denied");
      const editorRoots = [canonicalCwd, ...(await Promise.all(this.editorRoots.map(directory)))];
      if (this.closed) throw new AcpError("connection_closed");
      const connected = await connectSessionMcp(
        declarations,
        this.mcp,
        canonicalCwd,
        controller.signal,
      );
      mcp = connected.group;
      if (this.closed) throw new AcpError("connection_closed");
      const sessionId = restored?.sessionId ?? randomUUID();
      const client = editor?.(sessionId);
      let session: AcpSession | undefined;
      const build = async (config: AcpSessionConfig) => {
        const readOnly = config.mode === "read-only";
        const policy = Object.freeze({
          permissionPreset: config.mode,
          workspaceRoots: Object.freeze(editorRoots),
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
        const tools = createEditorTools(
          canonicalCwd,
          policy,
          client,
          () => {
            if (!session) throw new AcpError("configuration_error");
            return session.pendingRequests;
          },
          this.limits.maxTerminalOutputBytes,
        );
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
      const initial = await build(
        restored ? Object.freeze({ ...restored.config }) : this.configuration.initial(),
      );
      binding = initial.binding;
      if (restored && restored.driverKey !== binding.driver?.key)
        throw new AcpError("configuration_error");
      if (this.closed || controller.signal.aborted) throw new AcpError("connection_closed");
      const now = new Date().toISOString();
      let record: AcpSessionRecord = restored ?? {
        version: 1,
        sessionId,
        cwd: canonicalCwd,
        title: "Untitled session",
        createdAt: now,
        updatedAt: now,
        config: initial.context.config,
        nextToolId: 0,
        messages: [],
        transcript: [],
      };
      if (!restored && binding.driver) record = { ...record, driverKey: binding.driver.key };
      if (!restored) await this.store.put(record);
      if (this.closed || controller.signal.aborted) throw new AcpError("connection_closed");
      session = new AcpSession(
        initial.context,
        binding,
        controller,
        this.limits,
        this.images,
        this.reasoning,
        {
          persistence: { record, store: this.store },
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
