import type {
  AgentGenerationEndArgs,
  AgentGenerationErrorArgs,
  AgentGenerationObserver,
  AgentGenerationStartArgs,
  AgentObserverRegistration,
  AgentRunEndArgs,
  AgentRunErrorArgs,
  AgentRunObserver,
  AgentRunStartArgs,
  AgentToolEndArgs,
  AgentToolErrorArgs,
  AgentToolObserver,
  AgentToolStartArgs,
  AgentTraceInfo,
} from "./types";

export async function startAgentRunObservers(
  registrations: AgentObserverRegistration[],
  args: AgentRunStartArgs,
  failOnObserverError: boolean,
): Promise<ActiveAgentRunObservers> {
  const runObservers: AgentRunObserver[] = [];
  for (const registration of registrations) {
    try {
      const runObserver = await registration.observer.startRun(args);
      if (runObserver !== undefined) {
        runObservers.push(runObserver);
      }
    } catch (error) {
      if (failOnObserverError || registration.failOnObserverError === true) {
        throw error;
      }
    }
  }

  return new ActiveAgentRunObservers(runObservers, failOnObserverError);
}

export class ActiveAgentRunObservers {
  readonly trace: AgentTraceInfo | undefined;

  constructor(
    private readonly runObservers: AgentRunObserver[],
    private readonly failOnObserverError: boolean,
  ) {
    this.trace = runObservers.find((observer) => observer.trace !== undefined)?.trace;
  }

  async startGeneration(args: AgentGenerationStartArgs): Promise<ActiveGenerationObservers> {
    const generationObservers: AgentGenerationObserver[] = [];
    for (const runObserver of this.runObservers) {
      if (runObserver.startGeneration === undefined) {
        continue;
      }
      try {
        const generationObserver = await runObserver.startGeneration(args);
        if (generationObserver !== undefined) {
          generationObservers.push(generationObserver);
        }
      } catch (error) {
        this.handleError(error);
      }
    }
    return new ActiveGenerationObservers(generationObservers, this.failOnObserverError);
  }

  async startTool(args: AgentToolStartArgs): Promise<ActiveToolObservers> {
    const toolObservers: AgentToolObserver[] = [];
    for (const runObserver of this.runObservers) {
      if (runObserver.startTool === undefined) {
        continue;
      }
      try {
        const toolObserver = await runObserver.startTool(args);
        if (toolObserver !== undefined) {
          toolObservers.push(toolObserver);
        }
      } catch (error) {
        this.handleError(error);
      }
    }
    return new ActiveToolObservers(toolObservers, this.failOnObserverError);
  }

  async end(args: AgentRunEndArgs): Promise<void> {
    for (const runObserver of this.runObservers) {
      try {
        await runObserver.end(args);
      } catch (error) {
        this.handleError(error);
      }
    }
  }

  async error(args: AgentRunErrorArgs): Promise<void> {
    for (const runObserver of this.runObservers) {
      if (runObserver.error === undefined) {
        continue;
      }
      try {
        await runObserver.error(args);
      } catch (error) {
        this.handleError(error);
      }
    }
  }

  private handleError(error: unknown): void {
    if (this.failOnObserverError) {
      throw error;
    }
  }
}

export class ActiveGenerationObservers {
  constructor(
    private readonly generationObservers: AgentGenerationObserver[],
    private readonly failOnObserverError: boolean,
  ) {}

  async end(args: AgentGenerationEndArgs): Promise<void> {
    for (const observer of this.generationObservers) {
      try {
        await observer.end(args);
      } catch (error) {
        this.handleError(error);
      }
    }
  }

  async error(args: AgentGenerationErrorArgs): Promise<void> {
    for (const observer of this.generationObservers) {
      if (observer.error === undefined) {
        continue;
      }
      try {
        await observer.error(args);
      } catch (error) {
        this.handleError(error);
      }
    }
  }

  private handleError(error: unknown): void {
    if (this.failOnObserverError) {
      throw error;
    }
  }
}

export class ActiveToolObservers {
  constructor(
    private readonly toolObservers: AgentToolObserver[],
    private readonly failOnObserverError: boolean,
  ) {}

  async end(args: AgentToolEndArgs): Promise<void> {
    for (const observer of this.toolObservers) {
      try {
        await observer.end(args);
      } catch (error) {
        this.handleError(error);
      }
    }
  }

  async error(args: AgentToolErrorArgs): Promise<void> {
    for (const observer of this.toolObservers) {
      if (observer.error === undefined) {
        continue;
      }
      try {
        await observer.error(args);
      } catch (error) {
        this.handleError(error);
      }
    }
  }

  private handleError(error: unknown): void {
    if (this.failOnObserverError) {
      throw error;
    }
  }
}
