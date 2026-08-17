import type { CompletionModel, JsonObject, Message } from "@anvia/core/completion";
import type { Hono } from "hono";
import type {
  AgentRunRequest,
  StudioAgent,
  StudioAgentModelPolicy,
  StudioAgentModelPolicyConfig,
  StudioAgentModelsSummary,
  StudioModelConfig,
  StudioModelDefinition,
  StudioModelModality,
  StudioModelProvider,
  StudioModelProviderConfig,
  StudioModelRef,
  StudioModelSummary,
  StudioModelsConfig,
} from "../types";
import { serializeError } from "./errors";
import { errorResponse } from "./http";

export const STUDIO_MODEL_METADATA_KEY = "studioModel";

type RuntimeProvider = StudioModelProvider & {
  staticModels: Map<string, StudioModelDefinition>;
};

export type StudioModelRegistry = {
  readonly defaultModelRef?: string;
  readonly providers: Map<string, RuntimeProvider>;
  readonly agentPolicies: Map<string, NormalizedAgentModelPolicy>;
  readonly modelCache: Map<string, CompletionModel>;
};

type NormalizedAgentModelPolicy = {
  defaultModelRef?: string;
  allowed?: string[];
};

type ResolveModelInput = {
  agent: StudioAgent;
  request: AgentRunRequest;
  sessionMetadata?: JsonObject | undefined;
};

export type StudioResolvedModel = {
  ref?: string;
  model?: CompletionModel;
  warnings: JsonObject[];
};

export function createStudioModelRegistry(
  config: StudioModelConfig | undefined,
): StudioModelRegistry | undefined {
  if (config === undefined) {
    return undefined;
  }

  const providers = new Map<string, RuntimeProvider>();
  for (const provider of config.providers) {
    const id = normalizeProviderId(provider.id);
    if (providers.has(id)) {
      throw new Error(`Duplicate Studio model provider id: ${id}`);
    }
    const staticModels = new Map<string, StudioModelDefinition>();
    for (const model of provider.models ?? []) {
      const modelId = normalizeModelId(model.id);
      if (staticModels.has(modelId)) {
        throw new Error(`Duplicate Studio model id for provider ${id}: ${modelId}`);
      }
      staticModels.set(modelId, { ...model, id: modelId });
    }
    const runtimeProvider: RuntimeProvider = {
      ...provider,
      id,
      staticModels,
    };
    if (provider.defaultModelId !== undefined) {
      runtimeProvider.defaultModelId = normalizeModelId(provider.defaultModelId);
    }
    providers.set(id, runtimeProvider);
  }

  const registry: StudioModelRegistry = {
    providers,
    agentPolicies: normalizeAgentPolicies(config.agents ?? {}),
    modelCache: new Map(),
  };
  if (config.defaultModelRef !== undefined) {
    Object.assign(registry, {
      defaultModelRef: normalizeModelRef(config.defaultModelRef),
    });
  }
  return registry;
}

export function studioModelsConfig(
  registry: StudioModelRegistry | undefined,
  agents: StudioAgent[],
): StudioModelsConfig | undefined {
  if (registry === undefined) {
    return undefined;
  }

  const providers = [...registry.providers.values()].map((provider): StudioModelProviderConfig => {
    const models = [...provider.staticModels.values()].map((model) =>
      modelSummary(provider, model.id, model),
    );
    const config: StudioModelProviderConfig = {
      id: provider.id,
      models,
    };
    if (provider.name !== undefined) config.name = provider.name;
    if (provider.defaultModelId !== undefined) config.defaultModelId = provider.defaultModelId;
    if (provider.metadata !== undefined) config.metadata = provider.metadata;
    return config;
  });

  const agentIds = new Set(agents.map((agent) => agent.id));
  const agentsConfig = Object.fromEntries(
    [...registry.agentPolicies.entries()]
      .filter(([agentId]) => agentIds.has(agentId))
      .map(([agentId, policy]) => [agentId, publicPolicy(policy)]),
  );

  const config: StudioModelsConfig = {
    providers,
    agents: agentsConfig,
  };
  if (registry.defaultModelRef !== undefined) config.defaultModelRef = registry.defaultModelRef;
  return config;
}

export function registerModelRoutes(
  app: Hono,
  props: { registry?: StudioModelRegistry | undefined; agentMap: Map<string, StudioAgent> },
): void {
  app.get("/models", async (c) => {
    if (props.registry === undefined) {
      return errorResponse(c, 404, "not_found", "Model registry not configured");
    }
    const providers = await Promise.all(
      [...props.registry.providers.values()].map((provider) => providerCatalog(provider)),
    );
    const response: { providers: StudioModelProviderConfig[]; defaultModelRef?: string } = {
      providers,
    };
    if (props.registry.defaultModelRef !== undefined) {
      response.defaultModelRef = props.registry.defaultModelRef;
    }
    return c.json(response);
  });

  app.get("/models/:providerId", async (c) => {
    if (props.registry === undefined) {
      return errorResponse(c, 404, "not_found", "Model registry not configured");
    }
    const provider = props.registry.providers.get(c.req.param("providerId"));
    if (provider === undefined) {
      return errorResponse(c, 404, "not_found", "Model provider not found");
    }
    return c.json(await providerCatalog(provider));
  });

  app.get("/agents/:agentId/models", async (c) => {
    const agentId = c.req.param("agentId");
    const agent = props.agentMap.get(agentId);
    if (agent === undefined) {
      return errorResponse(c, 404, "not_found", "Agent not found");
    }
    if (props.registry === undefined) {
      return c.json({
        agentId,
        models: [],
      } satisfies StudioAgentModelsSummary);
    }
    return c.json(await agentModelsCatalog(props.registry, agent));
  });
}

export function resolveStudioModel(
  registry: StudioModelRegistry | undefined,
  input: ResolveModelInput,
): StudioResolvedModel {
  if (registry === undefined) {
    return { warnings: [] };
  }

  const selectedRef =
    normalizeOptionalModelRef(input.request.model) ??
    sessionModelRef(input.sessionMetadata) ??
    registry.agentPolicies.get(input.agent.id)?.defaultModelRef ??
    registry.defaultModelRef;
  if (selectedRef === undefined) {
    return { warnings: [] };
  }

  ensureModelAllowed(registry, input.agent.id, selectedRef);
  const { providerId, modelId } = parseModelRef(selectedRef);
  const provider = registry.providers.get(providerId);
  if (provider === undefined) {
    throw new ModelSelectionError(`Unknown model provider: ${providerId}`);
  }

  let model = registry.modelCache.get(selectedRef);
  if (model === undefined) {
    model = provider.createCompletionModel({ modelId });
    registry.modelCache.set(selectedRef, model);
  }

  const metadata = provider.staticModels.get(modelId);
  return {
    ref: selectedRef,
    model,
    warnings: modelWarnings(selectedRef, metadata, input.request),
  };
}

export function sessionModelRef(metadata: JsonObject | undefined): string | undefined {
  const value = metadata?.[STUDIO_MODEL_METADATA_KEY];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

export function normalizeOptionalModelRef(ref: StudioModelRef | undefined): string | undefined {
  return ref === undefined ? undefined : normalizeModelRef(ref);
}

export function normalizeModelRef(ref: StudioModelRef): string {
  return `${normalizeProviderId(ref.providerId)}:${normalizeModelId(ref.modelId)}`;
}

export function parseModelRef(ref: string): { providerId: string; modelId: string } {
  const index = ref.indexOf(":");
  if (index <= 0 || index === ref.length - 1) {
    throw new ModelSelectionError(`Model ref must use provider:model format: ${ref}`);
  }
  return {
    providerId: normalizeProviderId(ref.slice(0, index)),
    modelId: normalizeModelId(ref.slice(index + 1)),
  };
}

export class ModelSelectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ModelSelectionError";
  }
}

async function agentModelsCatalog(
  registry: StudioModelRegistry,
  agent: StudioAgent,
): Promise<StudioAgentModelsSummary> {
  const policy = registry.agentPolicies.get(agent.id);
  const catalogs = await Promise.all([...registry.providers.values()].map(providerCatalog));
  const warnings = catalogs.flatMap((catalog) =>
    catalog.warning === undefined
      ? []
      : [{ providerId: catalog.id, warning: catalog.warning } satisfies JsonObject],
  );
  const models = catalogs
    .flatMap((catalog) => catalog.models)
    .filter((model) => {
      if (policy?.allowed === undefined) {
        return true;
      }
      return allowedByPolicy(policy.allowed, model.ref);
    });
  const exactPolicyModels = (policy?.allowed ?? [])
    .filter((allowed) => !allowed.endsWith(":*"))
    .filter((allowed) => models.every((model) => model.ref !== allowed))
    .flatMap((ref) => {
      try {
        const { providerId, modelId } = parseModelRef(ref);
        const provider = registry.providers.get(providerId);
        return provider === undefined
          ? []
          : [
              modelSummary(provider, modelId, {
                id: modelId,
              }),
            ];
      } catch {
        return [];
      }
    });

  const defaultModelRef = policy?.defaultModelRef ?? registry.defaultModelRef;
  const summary: StudioAgentModelsSummary = {
    agentId: agent.id,
    models: [...models, ...exactPolicyModels],
  };
  if (defaultModelRef !== undefined) summary.defaultModelRef = defaultModelRef;
  if (warnings.length > 0) summary.warnings = warnings;
  return summary;
}

async function providerCatalog(provider: RuntimeProvider): Promise<StudioModelProviderConfig> {
  const models = new Map<string, StudioModelSummary>();
  for (const model of provider.staticModels.values()) {
    models.set(model.id, modelSummary(provider, model.id, model));
  }

  let warning: string | undefined;
  if (provider.listModels !== undefined) {
    try {
      const listed = await provider.listModels();
      for (const model of listed.data) {
        const staticModel = provider.staticModels.get(model.id);
        const definition: StudioModelDefinition = { id: model.id };
        if (model.name !== undefined) definition.name = model.name;
        if (model.description !== undefined) definition.description = model.description;
        Object.assign(definition, staticModel);
        const metadata: JsonObject = {};
        if (model.type !== undefined) metadata.type = model.type;
        if (model.createdAt !== undefined) metadata.createdAt = model.createdAt;
        if (model.ownedBy !== undefined) metadata.ownedBy = model.ownedBy;
        if (model.contextLength !== undefined) metadata.contextLength = model.contextLength;
        Object.assign(metadata, staticModel?.metadata);
        definition.metadata = metadata;
        models.set(model.id, modelSummary(provider, model.id, definition));
      }
    } catch (error) {
      const serialized = serializeError(error);
      warning =
        typeof serialized === "object" && serialized !== null && "message" in serialized
          ? String(serialized.message)
          : String(error);
    }
  }

  const catalog: StudioModelProviderConfig = {
    id: provider.id,
    models: [...models.values()].sort((left, right) => left.ref.localeCompare(right.ref)),
  };
  if (provider.name !== undefined) catalog.name = provider.name;
  if (provider.defaultModelId !== undefined) catalog.defaultModelId = provider.defaultModelId;
  if (provider.metadata !== undefined) catalog.metadata = provider.metadata;
  if (warning !== undefined) catalog.warning = warning;
  return catalog;
}

function modelSummary(
  provider: RuntimeProvider,
  modelId: string,
  model: StudioModelDefinition,
): StudioModelSummary {
  const summary: StudioModelSummary = {
    ...model,
    id: modelId,
    ref: `${provider.id}:${modelId}`,
    providerId: provider.id,
  };
  if (provider.name !== undefined) summary.providerName = provider.name;
  return summary;
}

function ensureModelAllowed(registry: StudioModelRegistry, agentId: string, ref: string): void {
  const { providerId } = parseModelRef(ref);
  if (!registry.providers.has(providerId)) {
    throw new ModelSelectionError(`Unknown model provider: ${providerId}`);
  }
  const policy = registry.agentPolicies.get(agentId);
  if (policy?.allowed !== undefined && !allowedByPolicy(policy.allowed, ref)) {
    throw new ModelSelectionError(`Model ${ref} is not allowed for agent ${agentId}`);
  }
}

function allowedByPolicy(allowed: string[], ref: string): boolean {
  return allowed.some((entry) =>
    entry.endsWith(":*") ? ref.startsWith(entry.slice(0, -1)) : entry === ref,
  );
}

function normalizeAgentPolicies(
  policies: Record<string, StudioAgentModelPolicy>,
): Map<string, NormalizedAgentModelPolicy> {
  return new Map(
    Object.entries(policies).map(([agentId, policy]) => {
      const normalized: NormalizedAgentModelPolicy = {};
      if (policy.defaultModelRef !== undefined) {
        normalized.defaultModelRef = normalizeModelRef(policy.defaultModelRef);
      }
      if (policy.allowed !== undefined) {
        normalized.allowed = policy.allowed.map((entry) => {
          if (typeof entry === "string") {
            return normalizeWildcardModelRef(entry);
          }
          return normalizeModelRef(entry);
        });
      }
      return [agentId.trim(), normalized];
    }),
  );
}

function normalizeWildcardModelRef(ref: string): string {
  const normalized = ref.trim();
  if (!normalized.endsWith(":*")) {
    throw new ModelSelectionError(`Invalid wildcard model reference: ${ref}`);
  }
  return `${normalizeProviderId(normalized.slice(0, -2))}:*`;
}

function publicPolicy(policy: NormalizedAgentModelPolicy): StudioAgentModelPolicyConfig {
  const config: StudioAgentModelPolicyConfig = {};
  if (policy.defaultModelRef !== undefined) {
    config.defaultModelRef = policy.defaultModelRef;
  }
  if (policy.allowed !== undefined) config.allowed = policy.allowed;
  return config;
}

function modelWarnings(
  ref: string,
  model: StudioModelDefinition | undefined,
  request: AgentRunRequest,
): JsonObject[] {
  const warnings: JsonObject[] = [];
  const modalities = requestModalities(request);
  const missingModalities = [...modalities].filter(
    (modality) => !model?.modalities?.input.includes(modality),
  );
  if (model?.modalities !== undefined && missingModalities.length > 0) {
    warnings.push({
      model: ref,
      kind: "modality",
      message: `Model ${ref} does not declare input support for ${missingModalities.join(", ")}`,
      missing: missingModalities,
    });
  }

  if (request.stream === true && model?.capabilities?.streaming === false) {
    warnings.push({
      model: ref,
      kind: "capability",
      message: `Model ${ref} is configured as non-streaming but the run requested streaming`,
      capability: "streaming",
    });
  }

  return warnings;
}

function requestModalities(request: AgentRunRequest): Set<StudioModelModality> {
  const modalities = new Set<StudioModelModality>(["text"]);
  for (const message of requestMessages(request)) {
    if (message.role === "user" || message.role === "assistant") {
      if (typeof message.content === "string") continue;
      for (const content of message.content) {
        if (content.type === "image") {
          modalities.add("image");
        }
        if (content.type === "file") {
          modalities.add("document");
        }
      }
    }
  }
  return modalities;
}

function requestMessages(request: AgentRunRequest): readonly Message[] {
  return request.type === "messages" ? request.messages : [];
}

function normalizeProviderId(id: string): string {
  const trimmed = id.trim();
  if (trimmed.length === 0 || trimmed.includes(":")) {
    throw new ModelSelectionError("Model provider id must be non-empty and cannot contain ':'");
  }
  return trimmed;
}

function normalizeModelId(id: string): string {
  const trimmed = id.trim();
  if (trimmed.length === 0) {
    throw new ModelSelectionError("Model id cannot be empty");
  }
  return trimmed;
}
