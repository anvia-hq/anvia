export type PackageFamilyId =
  | "runtime"
  | "model-providers"
  | "embeddings"
  | "vector-stores"
  | "observability"
  | "tools-studio";

export interface PackageInfo {
  name: string;
  slug: string;
  description: string;
  family: PackageFamilyId;
  href: string;
  installCommand: string;
}

export interface PackageFamily {
  id: PackageFamilyId;
  label: string;
  title: string;
  description: string;
  packages: PackageInfo[];
}

const packageDefinitions = [
  {
    id: "runtime",
    label: "Runtime",
    title: "Core runtime",
    description: "Core building blocks for creating and running agents.",
    packages: [
      {
        name: "@anvia/core",
        slug: "core",
        description: "Core runtime primitives for context-aware Anvia agents.",
      },
      {
        name: "@anvia/server",
        slug: "server",
        description: "Server-side event stream helpers for Anvia applications.",
      },
      {
        name: "@anvia/react",
        slug: "react",
        description: "React hooks and client transports for Anvia applications.",
      },
      {
        name: "@anvia/logger",
        slug: "logger",
        description: "Structured logger adapters for Anvia.",
      },
    ],
  },
  {
    id: "model-providers",
    label: "Model Providers",
    title: "Provider adapters",
    description: "Adapters that connect external model providers to the runtime.",
    packages: [
      {
        name: "@anvia/openai",
        slug: "openai",
        description: "OpenAI provider adapter for Anvia.",
      },
      {
        name: "@anvia/anthropic",
        slug: "anthropic",
        description: "Anthropic provider adapter for Anvia.",
      },
      {
        name: "@anvia/gemini",
        slug: "gemini",
        description: "Gemini provider adapter for Anvia.",
      },
      {
        name: "@anvia/mistral",
        slug: "mistral",
        description: "Mistral provider adapter for Anvia.",
      },
    ],
  },
  {
    id: "embeddings",
    label: "Embeddings",
    title: "Embedding adapters",
    description: "Packages that create embeddings for retrieval workflows.",
    packages: [
      {
        name: "@anvia/fastembed",
        slug: "fastembed",
        description: "FastEmbed embedding model adapter for Anvia.",
      },
      {
        name: "@anvia/transformers",
        slug: "transformers",
        description: "Transformers.js embedding model adapter for Anvia.",
      },
    ],
  },
  {
    id: "vector-stores",
    label: "Vector Stores",
    title: "Storage adapters",
    description: "Storage adapters for retrieval and semantic search.",
    packages: [
      {
        name: "@anvia/qdrant",
        slug: "qdrant",
        description: "Qdrant vector store adapter for Anvia.",
      },
      {
        name: "@anvia/pinecone",
        slug: "pinecone",
        description: "Pinecone vector store adapter for Anvia.",
      },
      {
        name: "@anvia/pgvector",
        slug: "pgvector",
        description: "Postgres pgvector store adapter for Anvia.",
      },
      {
        name: "@anvia/redis",
        slug: "redis",
        description: "Redis vector store adapter for Anvia.",
      },
      {
        name: "@anvia/chroma",
        slug: "chroma",
        description: "ChromaDB vector store adapter for Anvia.",
      },
      {
        name: "@anvia/lancedb",
        slug: "lancedb",
        description: "LanceDB vector store adapter for Anvia.",
      },
      {
        name: "@anvia/milvus",
        slug: "milvus",
        description: "Milvus vector store adapter for Anvia.",
      },
      {
        name: "@anvia/weaviate",
        slug: "weaviate",
        description: "Weaviate vector store adapter for Anvia.",
      },
    ],
  },
  {
    id: "observability",
    label: "Observability",
    title: "Tracing adapters",
    description: "Tracing, run visibility, and production monitoring.",
    packages: [
      {
        name: "@anvia/langfuse",
        slug: "langfuse",
        description: "Langfuse tracing adapter for Anvia.",
      },
      {
        name: "@anvia/otel",
        slug: "otel",
        description: "OpenTelemetry tracing adapter for Anvia.",
      },
    ],
  },
  {
    id: "tools-studio",
    label: "Tools and Studio",
    title: "Developer tools",
    description: "Developer tools, sandboxing, and local workflow surfaces.",
    packages: [
      {
        name: "@anvia/sandbox",
        slug: "sandbox",
        description: "Sandboxed workspace tools for Anvia agents.",
      },
      {
        name: "@anvia/studio",
        slug: "studio",
        description: "Studio UI and HTTP runtime for Anvia agents.",
      },
    ],
  },
] as const;

export const packageFamilies: PackageFamily[] = packageDefinitions.map((family) => ({
  ...family,
  packages: family.packages.map((packageInfo) => ({
    ...packageInfo,
    family: family.id,
    href: packageDocsHref(packageInfo.slug),
    installCommand: `pnpm add ${packageInfo.name}`,
  })),
}));

export const packages = packageFamilies.flatMap((family) => family.packages);

export const packageCount = packages.length;

function packageDocsHref(slug: string) {
  if (slug === "sandbox") {
    return "/docs/basics/sandbox-tools";
  }

  if (slug === "studio") {
    return "/docs/basics/studio-runtime";
  }

  return `/docs/packages/${slug}`;
}
