export type PackageFamilyId =
  | "runtime"
  | "model-providers"
  | "embeddings"
  | "vector-stores"
  | "observability"
  | "tools-studio";

export type PackageDocPageId = string;

export interface PackageInfo {
  name: string;
  slug: string;
  description: string;
  family: PackageFamilyId;
  href: string;
  installCommand: string;
  version: string;
  sourceDirectory: string;
  readmePath?: string;
  changelogPath: string;
}

export interface PackageFamily {
  id: PackageFamilyId;
  label: string;
  title: string;
  description: string;
  packages: PackageInfo[];
}

export interface PackageDocPage {
  id: PackageDocPageId;
  label: string;
  title: string;
  description: string;
}

export interface PackageReferencePage {
  id: string;
  label: string;
  title: string;
  description: string;
}

export interface PackageDocMenuEntry {
  id: PackageDocPageId;
  label: string;
}

export interface PackageDocMenuGroup {
  title: string;
  entries: PackageDocMenuEntry[];
}

type PackageDefinition = Omit<PackageInfo, "family" | "href" | "installCommand">;

interface PackageFamilyDefinition {
  id: PackageFamilyId;
  label: string;
  title: string;
  description: string;
  packages: PackageDefinition[];
}

export const packageDocPages: PackageDocPage[] = [
  {
    id: "overview",
    label: "Overview",
    title: "Overview",
    description: "What the package is for and where it fits in the Anvia package set.",
  },
  {
    id: "getting-started",
    label: "Getting Started",
    title: "Getting Started",
    description: "Install the package and wire it into an Anvia project.",
  },
  {
    id: "usage-patterns",
    label: "Usage Patterns",
    title: "Usage Patterns",
    description:
      "Common ways to compose the package with runtime, provider, transport, and adapter packages.",
  },
  {
    id: "examples",
    label: "Examples",
    title: "Examples",
    description: "Small example shapes that show how this package should be taught in docs.",
  },
  {
    id: "changelog",
    label: "Changelog",
    title: "Changelog",
    description: "Where to track package releases and update notes.",
  },
  {
    id: "reference",
    label: "Reference",
    title: "Reference",
    description: "Public API signatures, contracts, return behavior, and errors.",
  },
];

export const packageReferencePagesBySlug: Record<string, PackageReferencePage[]> = {
  core: [
    defineReferencePage(
      "reference",
      "Reference",
      "Core Reference",
      "Public exports from @anvia/core and its subpaths.",
    ),
    defineReferencePage(
      "reference/agent",
      "Agent",
      "Agent",
      "Agent construction, built-agent behavior, dynamic context, and event-store contracts.",
    ),
    defineReferencePage("reference/hooks", "Hooks", "Hooks", "Prompt lifecycle hooks."),
    defineReferencePage(
      "reference/request",
      "Request",
      "Request",
      "Prompt requests, prompt responses, stream events, and prompt-run errors.",
    ),
    defineReferencePage(
      "reference/completion",
      "Completion",
      "Completion",
      "Completion messages, models, middleware, helpers, and request builders.",
    ),
    defineReferencePage(
      "reference/image-generation",
      "Image Generation",
      "Image Generation",
      "Provider-neutral image generation contracts.",
    ),
    defineReferencePage(
      "reference/audio-generation",
      "Audio Generation",
      "Audio Generation",
      "Provider-neutral audio generation contracts.",
    ),
    defineReferencePage(
      "reference/transcription",
      "Transcription",
      "Transcription",
      "Provider-neutral transcription contracts.",
    ),
    defineReferencePage(
      "reference/tools",
      "Tools",
      "Tools",
      "Tool definitions, registries, middleware, approvals, and errors.",
    ),
    defineReferencePage(
      "reference/guardrails",
      "Guardrails",
      "Guardrails",
      "Experimental input and output policy APIs.",
    ),
    defineReferencePage(
      "reference/pipeline",
      "Pipeline",
      "Pipeline",
      "Typed pipeline builders, stages, batch runs, and observers.",
    ),
    defineReferencePage(
      "reference/extractor",
      "Extractor",
      "Extractor",
      "Structured extraction helpers.",
    ),
    defineReferencePage(
      "reference/evals",
      "Evals",
      "Evals",
      "Eval suites, metrics, reporters, and targets.",
    ),
    defineReferencePage("reference/loaders", "Loaders", "Loaders", "Node file and PDF loaders."),
    defineReferencePage(
      "reference/embeddings",
      "Embeddings",
      "Embeddings",
      "Embedding models, embedded documents, and vector helpers.",
    ),
    defineReferencePage(
      "reference/model-listing",
      "Model Listing",
      "Model Listing",
      "Provider-neutral model listing contracts.",
    ),
    defineReferencePage(
      "reference/vector-store",
      "Vector Store",
      "Vector Store",
      "Vector store interfaces, filters, and in-memory implementations.",
    ),
    defineReferencePage(
      "reference/memory",
      "Memory",
      "Memory",
      "Session memory interfaces and stores.",
    ),
    defineReferencePage(
      "reference/mcp",
      "MCP",
      "MCP",
      "MCP connection helpers and normalized types.",
    ),
    defineReferencePage(
      "reference/observability",
      "Observability",
      "Observability",
      "Observer interfaces, trace options, and scores.",
    ),
    defineReferencePage(
      "reference/skills",
      "Skills",
      "Skills",
      "Skill loading, validation, and generated tools.",
    ),
    defineReferencePage(
      "reference/streaming",
      "Streaming",
      "Streaming",
      "Readable stream helpers.",
    ),
    defineReferencePage("reference/ui", "UI", "UI", "UI message stream protocol and adapters."),
    defineReferencePage(
      "reference/internal-agent",
      "Internal Agent",
      "Internal Agent",
      "Unstable internal agent runtime helpers.",
    ),
    defineReferencePage("reference/schema", "Schema", "Schema", "Shared schema type aliases."),
  ],
  studio: [
    defineReferencePage(
      "reference",
      "Reference",
      "Studio Reference",
      "Public exports from @anvia/studio.",
    ),
    defineReferencePage(
      "reference/runtime",
      "Runtime",
      "Studio Runtime",
      "Studio class, server lifecycle, config, and run request contracts.",
    ),
    defineReferencePage(
      "reference/sessions",
      "Sessions",
      "Studio Sessions",
      "Session stores and session records.",
    ),
    defineReferencePage(
      "reference/traces",
      "Traces",
      "Studio Traces",
      "Trace stores, trace observer, and trace records.",
    ),
    defineReferencePage(
      "reference/approvals",
      "Approvals",
      "Studio Approvals",
      "Approval and human-input events.",
    ),
    defineReferencePage(
      "reference/stores",
      "Stores",
      "Studio Stores",
      "SQLite and in-memory store factories.",
    ),
    defineReferencePage(
      "reference/types",
      "Types",
      "Studio Types",
      "Studio HTTP and run event contracts.",
    ),
  ],
};

const packageDefinitions: PackageFamilyDefinition[] = [
  {
    id: "runtime",
    label: "Runtime",
    title: "Core runtime",
    description: "Runtime packages for agents, transports, UI clients, and logs.",
    packages: [
      definePackage(
        "@anvia/core",
        "core",
        "0.12.2",
        "packages/core",
        "Core runtime primitives for context-aware Anvia agents.",
        true,
      ),
      definePackage(
        "@anvia/server",
        "server",
        "0.4.9",
        "packages/server",
        "Server-side event stream helpers for Anvia applications.",
        true,
      ),
      definePackage(
        "@anvia/react",
        "react",
        "0.7.9",
        "packages/react",
        "React hooks and client transports for Anvia applications.",
        true,
      ),
      definePackage(
        "@anvia/react-ui",
        "react-ui",
        "0.2.0",
        "packages/react-ui",
        "Composable React UI primitives for Anvia chat and completion experiences.",
        true,
      ),
      definePackage(
        "@anvia/logger",
        "logger",
        "0.3.10",
        "packages/logger",
        "Structured logger adapters for Anvia.",
        true,
      ),
    ],
  },
  {
    id: "model-providers",
    label: "Model Providers",
    title: "Provider adapters",
    description: "Provider packages that connect hosted model APIs to the runtime.",
    packages: [
      definePackage(
        "@anvia/openai",
        "openai",
        "0.3.15",
        "packages/provider-openai",
        "OpenAI provider adapter for Anvia.",
        true,
      ),
      definePackage(
        "@anvia/anthropic",
        "anthropic",
        "0.3.13",
        "packages/provider-anthropic",
        "Anthropic provider adapter for Anvia.",
        true,
      ),
      definePackage(
        "@anvia/gemini",
        "gemini",
        "0.2.10",
        "packages/provider-gemini",
        "Gemini provider adapter for Anvia.",
        true,
      ),
      definePackage(
        "@anvia/mistral",
        "mistral",
        "0.3.3",
        "packages/provider-mistral",
        "Mistral provider adapter for Anvia.",
        true,
      ),
    ],
  },
  {
    id: "embeddings",
    label: "Embeddings",
    title: "Embedding adapters",
    description: "Packages that create vectors before retrieval, indexing, or semantic search.",
    packages: [
      definePackage(
        "@anvia/fastembed",
        "fastembed",
        "0.2.11",
        "packages/embedding-fastembed",
        "FastEmbed embedding model adapter for Anvia.",
        true,
      ),
      definePackage(
        "@anvia/transformers",
        "transformers",
        "0.2.11",
        "packages/embedding-transformers",
        "Transformers.js embedding model adapter for Anvia.",
        true,
      ),
    ],
  },
  {
    id: "vector-stores",
    label: "Vector Stores",
    title: "Storage adapters",
    description: "Storage adapters for retrieval and semantic search.",
    packages: [
      definePackage(
        "@anvia/qdrant",
        "qdrant",
        "0.2.10",
        "packages/vector-qdrant",
        "Qdrant vector store adapter for Anvia.",
        true,
      ),
      definePackage(
        "@anvia/pinecone",
        "pinecone",
        "0.3.6",
        "packages/vector-pinecone",
        "Pinecone vector store adapter for Anvia.",
        false,
      ),
      definePackage(
        "@anvia/pgvector",
        "pgvector",
        "0.2.11",
        "packages/vector-pgvector",
        "Postgres pgvector store adapter for Anvia.",
        true,
      ),
      definePackage(
        "@anvia/redis",
        "redis",
        "0.2.5",
        "packages/vector-redis",
        "Redis vector store adapter for Anvia.",
        false,
      ),
      definePackage(
        "@anvia/chroma",
        "chroma",
        "0.2.11",
        "packages/vector-chroma",
        "ChromaDB vector store adapter for Anvia.",
        true,
      ),
      definePackage(
        "@anvia/lancedb",
        "lancedb",
        "0.2.3",
        "packages/vector-lancedb",
        "LanceDB vector store adapter for Anvia.",
        false,
      ),
      definePackage(
        "@anvia/milvus",
        "milvus",
        "0.3.6",
        "packages/vector-milvus",
        "Milvus vector store adapter for Anvia.",
        false,
      ),
      definePackage(
        "@anvia/weaviate",
        "weaviate",
        "0.2.3",
        "packages/vector-weaviate",
        "Weaviate vector store adapter for Anvia.",
        false,
      ),
    ],
  },
  {
    id: "observability",
    label: "Observability",
    title: "Tracing adapters",
    description: "Tracing, run visibility, and production monitoring packages.",
    packages: [
      definePackage(
        "@anvia/langfuse",
        "langfuse",
        "0.3.4",
        "packages/observability-langfuse",
        "Langfuse tracing adapter for Anvia.",
        true,
      ),
      definePackage(
        "@anvia/otel",
        "otel",
        "0.2.11",
        "packages/observability-otel",
        "OpenTelemetry tracing adapter for Anvia.",
        true,
      ),
    ],
  },
  {
    id: "tools-studio",
    label: "Tools and Studio",
    title: "Developer tools",
    description: "Developer tools, sandboxing, and local workflow surfaces.",
    packages: [
      definePackage(
        "@anvia/sandbox",
        "sandbox",
        "0.3.5",
        "packages/tool-sandbox",
        "Sandboxed workspace tools for Anvia agents.",
        false,
      ),
      definePackage(
        "@anvia/studio",
        "studio",
        "0.7.18",
        "packages/tool-studio",
        "Studio UI and HTTP runtime for Anvia agents.",
        true,
      ),
    ],
  },
];

export const packageFamilies: PackageFamily[] = packageDefinitions.map((family) => ({
  ...family,
  packages: family.packages.map((packageInfo) => ({
    ...packageInfo,
    family: family.id,
    href: packageDocHref(packageInfo.slug, "overview"),
    installCommand: `pnpm add ${packageInfo.name}`,
  })),
}));

export const packages = packageFamilies.flatMap((family) => family.packages);

export const packageCount = packages.length;

export function getPackageBySlug(slug: string) {
  return packages.find((packageInfo) => packageInfo.slug === slug);
}

export function getPackageDocPage(pageId: string) {
  return packageDocPages.find((page) => page.id === pageId);
}

export function getPackageReferencePages(packageSlug: string) {
  return packageReferencePagesBySlug[packageSlug] ?? [];
}

export function getPackageDocMenuGroups(
  packageSlug: string,
  packageName: string,
): PackageDocMenuGroup[] {
  const packageReferencePages = getPackageReferencePages(packageSlug);
  const visiblePackageDocPages =
    packageReferencePages.length > 0
      ? packageDocPages.filter((page) => page.id !== "reference")
      : packageDocPages;

  return [
    {
      title: packageName,
      entries: visiblePackageDocPages.map((page) => ({
        id: page.id,
        label: page.label,
      })),
    },
    ...(packageReferencePages.length > 0
      ? [
          {
            title: "Reference",
            entries: packageReferencePages.map((page) => ({
              id: page.id,
              label: page.label,
            })),
          },
        ]
      : []),
  ];
}

export function packageDocHref(packageSlug: string, pageId: PackageDocPageId) {
  return `/docs/packages/${packageSlug}/${pageId}`;
}

export function packageReferenceHref(packageSlug: string, referencePageId: string) {
  return `/docs/packages/${packageSlug}/${referencePageId}`;
}

export function packageLandingHref(packageSlug: string) {
  return packageDocHref(packageSlug, "overview");
}

function defineReferencePage(
  id: string,
  label: string,
  title: string,
  description: string,
): PackageReferencePage {
  return { id, label, title, description };
}

function definePackage(
  name: string,
  slug: string,
  version: string,
  sourceDirectory: string,
  description: string,
  hasReadme: boolean,
): PackageDefinition {
  return {
    name,
    slug,
    version,
    sourceDirectory,
    description,
    readmePath: hasReadme ? `${sourceDirectory}/README.md` : undefined,
    changelogPath: `${sourceDirectory}/CHANGELOG.md`,
  };
}
