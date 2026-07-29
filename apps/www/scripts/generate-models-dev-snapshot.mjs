import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const sourceUrl = "https://models.dev/api.json";
const scriptDir = dirname(fileURLToPath(import.meta.url));
const appRoot = join(scriptDir, "..");
const outputPath = join(appRoot, "src/lib/models-dev-snapshot.json");
const providerDocsDir = join(appRoot, "src/content/docs/providers/gateway");

const response = await fetch(sourceUrl);

if (!response.ok) {
  throw new Error(`Failed to fetch ${sourceUrl}: ${response.status} ${response.statusText}`);
}

const rawCatalog = await response.json();
const providers = Object.values(rawCatalog)
  .map(normalizeProvider)
  .sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id));
const slugs = new Map();

for (const provider of providers) {
  const existing = slugs.get(provider.slug);
  if (existing !== undefined) {
    throw new Error(
      `Provider slug collision for "${provider.slug}": ${existing} and ${provider.id}`,
    );
  }
  slugs.set(provider.slug, provider.id);
}

const snapshot = {
  sourceUrl,
  generatedAt: process.env.MODELS_DEV_SNAPSHOT_DATE ?? new Date().toISOString().slice(0, 10),
  providerCount: providers.length,
  modelCount: providers.reduce((count, provider) => count + provider.models.length, 0),
  providers,
};

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(snapshot, null, 2)}\n`);
writeProviderMarkdownFiles(snapshot);

console.info(
  `Generated ${providers.length} providers and ${snapshot.modelCount} models in ${outputPath}`,
);
console.info(`Generated ${providers.length} gateway provider docs in ${providerDocsDir}`);

function normalizeProvider(provider) {
  const models = Object.values(provider.models ?? {})
    .map(normalizeModel)
    .sort((left, right) => left.id.localeCompare(right.id));

  return compact({
    id: stringValue(provider.id),
    slug: slugify(stringValue(provider.id)),
    name: stringValue(provider.name) ?? stringValue(provider.id),
    category: providerCategory(provider.npm),
    npm: stringValue(provider.npm),
    api: stringValue(provider.api),
    env: stringArray(provider.env),
    doc: stringValue(provider.doc),
    modelCount: models.length,
    capabilities: aggregateCapabilities(models),
    models,
  });
}

function normalizeModel(model) {
  return compact({
    id: stringValue(model.id),
    name: stringValue(model.name) ?? stringValue(model.id),
    family: stringValue(model.family),
    inputModalities: stringArray(model.modalities?.input),
    outputModalities: stringArray(model.modalities?.output),
    attachment: booleanValue(model.attachment),
    reasoning: booleanValue(model.reasoning),
    reasoningOptions: arrayValue(model.reasoning_options),
    toolCall: booleanValue(model.tool_call),
    structuredOutput: booleanValue(model.structured_output),
    temperature: booleanValue(model.temperature),
    openWeights: booleanValue(model.open_weights),
    knowledge: stringValue(model.knowledge),
    releaseDate: stringValue(model.release_date),
    lastUpdated: stringValue(model.last_updated),
    limit: objectValue(model.limit),
    cost: objectValue(model.cost),
  });
}

function aggregateCapabilities(models) {
  const inputModalities = new Set();
  const outputModalities = new Set();
  let attachment = 0;
  let reasoning = 0;
  let toolCall = 0;
  let structuredOutput = 0;
  let temperature = 0;
  let openWeights = 0;

  for (const model of models) {
    for (const modality of model.inputModalities ?? []) inputModalities.add(modality);
    for (const modality of model.outputModalities ?? []) outputModalities.add(modality);
    if (model.attachment === true) attachment += 1;
    if (model.reasoning === true) reasoning += 1;
    if (model.toolCall === true) toolCall += 1;
    if (model.structuredOutput === true) structuredOutput += 1;
    if (model.temperature === true) temperature += 1;
    if (model.openWeights === true) openWeights += 1;
  }

  return {
    inputModalities: [...inputModalities].sort(),
    outputModalities: [...outputModalities].sort(),
    attachment,
    reasoning,
    toolCall,
    structuredOutput,
    temperature,
    openWeights,
  };
}

function providerCategory(npm) {
  if (npm === "@ai-sdk/openai-compatible") return "openai-compatible";
  if (npm === "@ai-sdk/anthropic") return "anthropic-compatible";
  if (npm === "@ai-sdk/openai") return "openai-sdk";
  if (npm === "@ai-sdk/gateway") return "gateway";
  if (typeof npm === "string" && npm.includes("anthropic")) return "anthropic-adapter";
  if (typeof npm === "string" && npm.includes("openai")) return "openai-adapter";
  if (typeof npm === "string" && npm.length > 0) return "provider-adapter";
  return "other";
}

function writeProviderMarkdownFiles(snapshot) {
  rmSync(providerDocsDir, { recursive: true, force: true });
  mkdirSync(providerDocsDir, { recursive: true });

  snapshot.providers.forEach((provider, index) => {
    writeFileSync(join(providerDocsDir, `${provider.slug}.md`), providerMarkdown(provider, index));
  });
}

function providerMarkdown(provider, index) {
  const lines = [
    "---",
    `title: ${yamlString(provider.name)}`,
    `description: ${yamlString(providerDescription(provider))}`,
    "section: providers",
    "sidebar:",
    "  group: LLM Gateway",
    `  order: ${1000 + index}`,
    `  label: ${yamlString(provider.name)}`,
    "---",
    "",
    connectionMarkdown(provider),
    "",
    anviaUsageMarkdown(provider),
    "",
    capabilityMarkdown(provider),
    "",
    modelMarkdown(provider),
    "",
    "Read [Gateway caveats](/docs/providers/gateway-caveats) before enabling this provider in production.",
    "",
  ];

  return `${lines.join("\n")}\n`;
}

function providerDescription(provider) {
  const sdk = anviaSdkLabel(provider);

  if (sdk !== "No dedicated package") {
    return `Use ${provider.name} through ${sdk}.`;
  }

  return `Review ${provider.name} connection details and model capabilities.`;
}

function connectionMarkdown(provider) {
  const rows = [
    ["Anvia SDK", anviaSdkLabel(provider)],
    ["Compatibility", compatibilityLabel(provider)],
    ["API URL", provider.api ?? "Not listed in models.dev"],
    ["Environment", provider.env?.map((name) => `\`${name}\``).join(", ") ?? "Not listed"],
    [
      "Provider docs",
      provider.doc === undefined ? "Not listed" : `[${provider.doc}](${provider.doc})`,
    ],
    ["Models", String(provider.modelCount)],
  ];

  return tableMarkdown("## Connection", ["Field", "Value"], rows);
}

function anviaUsageMarkdown(provider) {
  const modelId = provider.models[0]?.id ?? "provider/model";
  const envName = provider.env?.[0] ?? "PROVIDER_API_KEY";

  if (provider.id === "google-vertex-anthropic") {
    return [
      "## Anvia Usage",
      "",
      "This provider maps to `AnthropicVertexClient` in the Anvia Anthropic provider. Use the [Anthropic provider](/docs/providers/anthropic#vertex-ai) guide for authentication and production setup.",
      "",
      "```ts",
      'import { AnthropicVertexClient } from "@anvia/anthropic";',
      "",
      "const client = new AnthropicVertexClient({",
      "  projectId: process.env.GOOGLE_VERTEX_PROJECT,",
      '  region: process.env.GOOGLE_VERTEX_LOCATION ?? "global",',
      "});",
      "",
      `const model = client.completionModel(${JSON.stringify(modelId)});`,
      "```",
    ].join("\n");
  }

  if (provider.category === "openai-compatible" && provider.api !== undefined) {
    return [
      "## Anvia Usage",
      "",
      "This provider is listed as OpenAI-compatible. Start with `@anvia/openai` and the chat-completions adapter, then smoke test the exact workflow.",
      "",
      "```ts",
      'import { OpenAIClient } from "@anvia/openai";',
      "",
      "const client = new OpenAIClient({",
      `  apiKey: ${envExpression(envName)},`,
      `  baseUrl: ${JSON.stringify(provider.api)},`,
      '  completionApi: "chat",',
      "});",
      "",
      `const model = client.completionModel(${JSON.stringify(modelId)});`,
      "```",
    ].join("\n");
  }

  if (provider.category === "anthropic-compatible") {
    const clientOptions =
      provider.api === undefined
        ? [`  apiKey: ${envExpression(envName)},`]
        : [`  apiKey: ${envExpression(envName)},`, `  baseUrl: ${JSON.stringify(provider.api)},`];

    return [
      "## Anvia Usage",
      "",
      provider.api === undefined
        ? "This provider maps to the Anvia Anthropic adapter without a separate API URL. Use the first-party Anvia Anthropic provider guide when this is Anthropic itself."
        : "This provider is listed as Anthropic-compatible. Start with `@anvia/anthropic` and a custom `baseUrl`, then smoke test the exact workflow.",
      "",
      "```ts",
      'import { AnthropicClient } from "@anvia/anthropic";',
      "",
      "const client = new AnthropicClient({",
      ...clientOptions,
      "});",
      "",
      `const model = client.completionModel(${JSON.stringify(modelId)});`,
      "```",
    ].join("\n");
  }

  if (provider.id === "openai") {
    return [
      "## Anvia Usage",
      "",
      "This is the first-party OpenAI catalog entry. Use the [OpenAI provider](/docs/providers/openai) guide for normal Anvia setup.",
      "",
      "```ts",
      'import { OpenAIClient } from "@anvia/openai";',
      "",
      "const client = new OpenAIClient({",
      `  apiKey: ${envExpression(envName)},`,
      "});",
      "",
      `const model = client.completionModel(${JSON.stringify(modelId)});`,
      "```",
    ].join("\n");
  }

  if (provider.id === "google") {
    return [
      "## Anvia Usage",
      "",
      "This provider maps to the Anvia Gemini provider. Use the [Gemini provider](/docs/providers/gemini) guide for the complete setup.",
      "",
      "```ts",
      'import { GeminiClient } from "@anvia/gemini";',
      "",
      "const client = new GeminiClient({",
      `  apiKey: ${envExpression(provider.env?.[0] ?? "GEMINI_API_KEY")},`,
      "});",
      "",
      `const model = client.completionModel(${JSON.stringify(modelId)});`,
      "```",
    ].join("\n");
  }

  if (provider.id === "google-vertex") {
    return [
      "## Anvia Usage",
      "",
      "This provider maps to the Vertex AI mode in the Anvia Gemini provider. Use the [Gemini provider](/docs/providers/gemini) guide for the complete setup.",
      "",
      "```ts",
      'import { GeminiClient } from "@anvia/gemini";',
      "",
      "const client = new GeminiClient({",
      "  vertexai: true,",
      "  project: process.env.GOOGLE_VERTEX_PROJECT,",
      '  location: process.env.GOOGLE_VERTEX_LOCATION ?? "us-central1",',
      "});",
      "",
      `const model = client.completionModel(${JSON.stringify(modelId)});`,
      "```",
    ].join("\n");
  }

  if (provider.id === "mistral") {
    return [
      "## Anvia Usage",
      "",
      "This provider maps to the Anvia Mistral provider. Use the [Mistral provider](/docs/providers/mistral) guide for the complete setup.",
      "",
      "```ts",
      'import { MistralClient } from "@anvia/mistral";',
      "",
      "const client = new MistralClient({",
      `  apiKey: ${envExpression(provider.env?.[0] ?? "MISTRAL_API_KEY")},`,
      "});",
      "",
      `const model = client.completionModel(${JSON.stringify(modelId)});`,
      "```",
    ].join("\n");
  }

  return [
    "## Anvia Usage",
    "",
    "Anvia does not currently ship a dedicated provider package for this endpoint. Use the connection details here for evaluation, then build a custom integration against `@anvia/core` completion contracts if you need to run it today.",
  ].join("\n");
}

function anviaSdkLabel(provider) {
  if (provider.category === "openai-compatible" && provider.api !== undefined) {
    return "@anvia/openai";
  }
  if (provider.category === "anthropic-compatible") {
    return "@anvia/anthropic";
  }
  if (provider.id === "openai") {
    return "@anvia/openai";
  }
  if (provider.id === "anthropic") {
    return "@anvia/anthropic";
  }
  if (provider.id === "google-vertex-anthropic") {
    return "@anvia/anthropic";
  }
  if (provider.id === "google" || provider.id === "google-vertex") {
    return "@anvia/gemini";
  }
  if (provider.id === "mistral") {
    return "@anvia/mistral";
  }

  return "No dedicated package";
}

function compatibilityLabel(provider) {
  if (provider.id === "openai") return "First-party OpenAI endpoint";
  if (provider.id === "anthropic") return "First-party Anthropic endpoint";
  if (provider.id === "google-vertex-anthropic") return "Anthropic on Vertex AI";
  if (provider.id === "google") return "Gemini API provider";
  if (provider.id === "google-vertex") return "Vertex AI provider";
  if (provider.id === "mistral") return "First-party Mistral endpoint";

  const labels = {
    "openai-compatible": "OpenAI-compatible endpoint",
    "anthropic-compatible": "Anthropic-compatible endpoint",
    gateway: "Gateway provider metadata",
    "openai-sdk": "OpenAI-compatible metadata",
    "anthropic-adapter": "Anthropic-compatible metadata",
    "openai-adapter": "OpenAI-compatible metadata",
    "provider-adapter": "Provider metadata",
    other: "Provider metadata",
  };

  return labels[provider.category] ?? "Provider metadata";
}

function capabilityMarkdown(provider) {
  const rows = [
    ["Input modalities", provider.capabilities.inputModalities.join(", ") || "-"],
    ["Output modalities", provider.capabilities.outputModalities.join(", ") || "-"],
    ["Attachments", capabilityCount(provider.capabilities.attachment, provider.modelCount)],
    ["Tools", capabilityCount(provider.capabilities.toolCall, provider.modelCount)],
    [
      "Structured output",
      capabilityCount(provider.capabilities.structuredOutput, provider.modelCount),
    ],
    ["Reasoning", capabilityCount(provider.capabilities.reasoning, provider.modelCount)],
    ["Temperature", capabilityCount(provider.capabilities.temperature, provider.modelCount)],
    ["Open weights", capabilityCount(provider.capabilities.openWeights, provider.modelCount)],
  ];

  return tableMarkdown("## Capabilities", ["Capability", "Value"], rows);
}

function modelMarkdown(provider) {
  const rows = provider.models.map((model) => [
    `\`${model.id}\`${model.name !== model.id ? `<br />${escapeTable(model.name)}` : ""}`,
    model.family ?? "-",
    model.inputModalities?.join(", ") ?? "-",
    model.outputModalities?.join(", ") ?? "-",
    modelCapabilityList(model),
    objectSummary(model.limit),
    objectSummary(model.cost),
    model.lastUpdated ?? model.releaseDate ?? "-",
  ]);

  return tableMarkdown(
    "## Models",
    ["Model", "Family", "Input", "Output", "Capabilities", "Limits", "Cost", "Updated"],
    rows,
  );
}

function tableMarkdown(title, headers, rows) {
  const lines = [
    title,
    "",
    `| ${headers.join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
  ];

  for (const row of rows) {
    lines.push(`| ${row.map((value) => escapeTable(value)).join(" | ")} |`);
  }

  return lines.join("\n");
}

function capabilityCount(count, total) {
  return `${count} / ${total} models`;
}

function modelCapabilityList(model) {
  const values = [
    model.toolCall === true ? "tools" : undefined,
    model.structuredOutput === true ? "schema" : undefined,
    model.reasoning === true ? "reasoning" : undefined,
    model.temperature === true ? "temperature" : undefined,
    model.openWeights === true ? "open weights" : undefined,
  ].filter((value) => value !== undefined);

  return values.length === 0 ? "-" : values.join(", ");
}

function objectSummary(value) {
  if (value === undefined) return "-";

  const entries = Object.entries(value).filter(([, entry]) => typeof entry !== "object");
  if (entries.length === 0) return "-";

  return entries.map(([key, entry]) => `${key}: ${primitiveSummary(entry)}`).join(" / ");
}

function primitiveSummary(value) {
  if (typeof value === "number" || typeof value === "string" || typeof value === "boolean") {
    return String(value);
  }
  return "-";
}

function envExpression(name) {
  return /^[A-Za-z_$][\w$]*$/.test(name)
    ? `process.env.${name}`
    : `process.env[${JSON.stringify(name)}]`;
}

function escapeTable(value) {
  return String(value).replaceAll("|", "\\|");
}

function yamlString(value) {
  return JSON.stringify(String(value));
}

function slugify(value) {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  if (slug.length === 0) {
    throw new Error(`Cannot create provider slug from id: ${value}`);
  }

  return slug;
}

function compact(value) {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => {
      if (entry === undefined) return false;
      if (Array.isArray(entry) && entry.length === 0) return false;
      return true;
    }),
  );
}

function stringValue(value) {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function booleanValue(value) {
  return typeof value === "boolean" ? value : undefined;
}

function stringArray(value) {
  return Array.isArray(value)
    ? [...new Set(value.filter((item) => typeof item === "string" && item.length > 0))].sort()
    : [];
}

function arrayValue(value) {
  return Array.isArray(value) && value.length > 0 ? value : undefined;
}

function objectValue(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value : undefined;
}
