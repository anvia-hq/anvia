import { createFileRoute } from "@tanstack/react-router";
import { HomeLayout } from "fumadocs-ui/layouts/home";
import {
  ArrowRight,
  BookOpen,
  Boxes,
  Code2,
  Database,
  Eye,
  GitBranch,
  Network,
  Package,
  Play,
  Route as RouteIcon,
  Terminal,
  Workflow,
  Zap,
} from "lucide-react";
import { baseOptions } from "@/lib/layout.shared";

export const Route = createFileRoute("/")({
  component: Page,
  head: () => ({
    meta: [
      {
        title: "Anvia - TypeScript runtime for application-owned AI workflows",
      },
      {
        name: "description",
        content:
          "Anvia helps TypeScript teams build provider-agnostic agents, typed tools, retrieval, pipelines, streaming, and observability inside application code.",
      },
    ],
  }),
});

const metrics = [
  { value: "13", label: "Runtime packages", icon: Package },
  { value: "4", label: "Model adapters", icon: Boxes },
  { value: "7", label: "Integration packages", icon: BookOpen },
  { value: "1", label: "Core package", icon: Zap },
];

const platformLayers = [
  {
    title: "Runtime core",
    description:
      "Agents, workflows, tools, structured output, history, events, and cancellation in one TypeScript-native execution layer.",
    icon: RouteIcon,
    stat: "01",
  },
  {
    title: "Model adapters",
    description:
      "OpenAI, Anthropic, Gemini, Mistral, and compatible endpoints behind one completion interface.",
    icon: GitBranch,
    stat: "02",
  },
  {
    title: "Data grounding",
    description:
      "Embeddings, retrieval, vector stores, and metadata filters as runtime primitives.",
    icon: Database,
    stat: "03",
  },
  {
    title: "Control surface",
    description:
      "Inspect sessions, traces, stream events, tool calls, approvals, and grouped execution.",
    icon: Eye,
    stat: "04",
  },
];

const docsEntrypoints = [
  {
    title: "Start building",
    description: "Create an agent, wire a model, add typed tools, and run locally.",
    href: "/docs/guides/getting-started",
    icon: Play,
  },
  {
    title: "Runtime concepts",
    description: "Understand context, tools, runs, histories, events, and workflows.",
    href: "/docs/guides",
    icon: Network,
  },
  {
    title: "Studio",
    description: "Inspect sessions, traces, tool calls, approvals, and live runs.",
    href: "/docs/studio/overview",
    icon: Workflow,
  },
  {
    title: "API reference",
    description: "Review package exports, public types, constructors, and adapters.",
    href: "/docs/reference",
    icon: Code2,
  },
];

const packageGroups = [
  {
    title: "Runtime",
    description: "Core agent primitives plus the local inspection surface.",
    packages: ["@anvia/core", "@anvia/studio"],
  },
  {
    title: "Model adapters",
    description: "Provider and compatible completion models behind one interface.",
    packages: ["@anvia/openai", "@anvia/anthropic", "@anvia/gemini", "@anvia/mistral"],
  },
  {
    title: "Retrieval",
    description: "Local embeddings and durable indexes for retrieval workflows.",
    packages: [
      "@anvia/fastembed",
      "@anvia/transformers",
      "@anvia/chroma",
      "@anvia/qdrant",
      "@anvia/pgvector",
    ],
  },
  {
    title: "Observability",
    description: "Trace and score Anvia runs through existing telemetry systems.",
    packages: ["@anvia/langfuse", "@anvia/otel"],
  },
];

function cx(...classes: Array<string | false>) {
  return classes.filter(Boolean).join(" ");
}

function twoColumnInteriorBorders(index: number, total: number) {
  return cx(
    index < total - 1 && "border-b",
    index >= total - 2 && "md:border-b-0",
    index % 2 === 0 && "md:border-r",
  );
}

function Page() {
  return (
    <HomeLayout {...baseOptions}>
      <main className="anvia-landing min-h-screen bg-[#050505] text-zinc-100">
        <section className="relative overflow-hidden border-b border-white/10">
          <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,.055)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.055)_1px,transparent_1px)] bg-[length:84px_84px] opacity-30" />
          <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(5,5,5,1)_0%,rgba(5,5,5,.98)_42%,rgba(5,5,5,.9)_100%)]" />

          <div className="relative mx-auto grid max-w-7xl overflow-hidden border-x border-white/10 bg-[#050505]/92 lg:grid-cols-2">
            <img
              src="/assets/anvia-hero-isometric.png"
              alt="Abstract Anvia runtime graphic with muted lime workflow paths"
              className="absolute inset-0 h-full w-full object-cover object-[68%_center] opacity-90"
            />
            <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(5,5,5,1)_0%,rgba(5,5,5,.96)_33%,rgba(5,5,5,.72)_54%,rgba(5,5,5,.12)_100%)]" />

            <div className="relative z-10 flex min-h-[620px] flex-col justify-center px-6 py-16 sm:px-10 lg:min-h-[680px] lg:px-12 lg:py-20">
              <h1
                className="text-[clamp(4.5rem,13vw,8.75rem)] font-semibold leading-[0.86] text-white lg:text-[clamp(6rem,9vw,8.75rem)]"
                style={{ letterSpacing: 0 }}
              >
                Anvia
              </h1>

              <p className="mt-8 max-w-2xl text-balance text-2xl leading-9 text-zinc-100 sm:text-3xl sm:leading-10">
                Build provider-agnostic agents inside your application code.
              </p>
              <p className="mt-5 max-w-2xl text-balance text-base leading-8 text-zinc-500">
                Use typed tools, structured output, retrieval, pipelines, streaming, and Studio
                inspection without giving up control of data, permissions, storage, or side effects.
              </p>

              <div className="mt-10 flex flex-col gap-2 sm:w-fit sm:flex-row">
                <a
                  href="/docs/guides/getting-started"
                  className="inline-flex h-12 items-center justify-center gap-2 rounded-lg bg-[#e5ff1f] px-6 text-sm font-semibold text-black transition hover:bg-[#d7f21b]"
                >
                  Start building
                  <ArrowRight className="size-4" />
                </a>
                <a
                  href="/docs/reference"
                  className="inline-flex h-12 items-center justify-center gap-2 rounded-lg bg-[#101010] px-6 text-sm font-medium text-white transition hover:bg-[#181818]"
                >
                  API reference
                </a>
              </div>
            </div>

            <div className="hidden min-h-[680px] lg:block" />
          </div>
        </section>

        <section className="border-b border-white/10">
          <div className="mx-auto grid max-w-7xl border-x border-white/10 bg-[#050505] md:grid-cols-4">
            {metrics.map((metric, index) => {
              const Icon = metric.icon;
              return (
                <div
                  className={cx(
                    "border-white/10 p-6",
                    index < metrics.length - 1 && "border-b md:border-b-0 md:border-r",
                  )}
                  key={metric.label}
                >
                  <div className="flex items-center justify-between gap-6">
                    <Icon className="size-4 text-[#e5ff1f]" />
                    <span className="font-mono text-[11px] uppercase tracking-[0.2em] text-zinc-600">
                      {metric.label}
                    </span>
                  </div>
                  <p className="mt-10 text-4xl font-semibold tracking-normal text-white">
                    {metric.value}
                  </p>
                </div>
              );
            })}
          </div>
        </section>

        <section className="border-b border-white/10">
          <div className="mx-auto grid max-w-7xl border-x border-white/10 bg-[#050505] lg:grid-cols-[0.78fr_1.22fr]">
            <div className="border-b border-white/10 p-6 sm:p-10 lg:border-b-0 lg:border-r lg:p-12">
              <p className="font-mono text-xs uppercase tracking-[0.22em] text-[#e5ff1f]">
                Platform shape
              </p>
              <h2 className="mt-6 max-w-xl text-4xl font-semibold leading-tight tracking-normal text-white sm:text-5xl">
                Runtime for real systems.
              </h2>
              <p className="mt-6 max-w-xl text-base leading-8 text-zinc-500">
                Your application owns credentials, storage, side effects, and deployment. Anvia
                standardizes execution contracts and inspection.
              </p>
            </div>

            <div className="grid md:grid-cols-2">
              {platformLayers.map((layer, index) => {
                const Icon = layer.icon;
                return (
                  <article
                    className={cx(
                      "group min-h-72 border-white/10 p-6 transition hover:bg-white/[0.035]",
                      twoColumnInteriorBorders(index, platformLayers.length),
                    )}
                    key={layer.title}
                  >
                    <div className="flex items-start justify-between gap-6">
                      <Icon className="size-5 text-[#e5ff1f]" />
                      <span className="font-mono text-xs text-zinc-600">{layer.stat}</span>
                    </div>
                    <h3 className="mt-20 text-2xl font-medium tracking-normal text-white">
                      {layer.title}
                    </h3>
                    <p className="mt-4 text-sm leading-7 text-zinc-500">{layer.description}</p>
                  </article>
                );
              })}
            </div>
          </div>
        </section>

        <section className="border-b border-white/10">
          <div className="mx-auto grid max-w-7xl border-x border-white/10 bg-[#050505] lg:grid-cols-[0.78fr_1.22fr]">
            <div className="border-b border-white/10 p-6 sm:p-10 lg:border-b-0 lg:border-r lg:p-12">
              <p className="font-mono text-xs uppercase tracking-[0.22em] text-[#e5ff1f]">
                Package system
              </p>
              <h2 className="mt-6 max-w-xl text-4xl font-semibold leading-tight tracking-normal text-white sm:text-5xl">
                Modular by design.
              </h2>
              <p className="mt-6 max-w-xl text-base leading-8 text-zinc-500">
                Install only the adapters you need. Keep the core execution model stable as
                providers, storage, and product requirements change.
              </p>
            </div>

            <div className="grid md:grid-cols-2">
              {packageGroups.map((group, index) => (
                <article
                  className={cx(
                    "flex min-h-80 flex-col justify-between border-white/10 p-6 transition hover:bg-white/[0.035]",
                    twoColumnInteriorBorders(index, packageGroups.length),
                  )}
                  key={group.title}
                >
                  <div>
                    <div className="flex items-start justify-between gap-6">
                      <div>
                        <p className="font-mono text-xs uppercase tracking-[0.18em] text-[#e5ff1f]">
                          {group.title}
                        </p>
                        <p className="mt-4 max-w-md text-sm leading-6 text-zinc-500">
                          {group.description}
                        </p>
                      </div>
                      <span className="font-mono text-xs text-zinc-700">
                        {group.packages.length}
                      </span>
                    </div>
                  </div>

                  <div className="mt-10 flex flex-wrap gap-2">
                    {group.packages.map((name) => (
                      <span
                        className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-white/10 bg-white/[0.025] px-3 font-mono text-[12px] text-zinc-200"
                        key={name}
                      >
                        <Terminal className="size-3.5 text-[#e5ff1f]" />
                        {name}
                      </span>
                    ))}
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="border-b border-white/10">
          <div className="mx-auto grid max-w-7xl border-x border-white/10 bg-[#050505] lg:grid-cols-[0.78fr_1.22fr]">
            <div className="border-b border-white/10 p-6 sm:p-10 lg:border-b-0 lg:border-r lg:p-12">
              <p className="font-mono text-xs uppercase tracking-[0.22em] text-[#e5ff1f]">
                Documentation
              </p>
              <h2 className="mt-6 max-w-xl text-4xl font-semibold leading-tight tracking-normal text-white sm:text-5xl">
                Choose your entry point.
              </h2>
              <p className="mt-6 max-w-xl text-base leading-8 text-zinc-500">
                Move from first run to production concerns through focused guides, Studio docs, and
                API references.
              </p>
              <a
                href="/docs"
                className="mt-10 inline-flex h-12 w-fit items-center justify-center gap-2 border border-[#e5ff1f]/40 bg-[#e5ff1f] px-5 text-sm font-semibold text-black transition hover:bg-[#d7f21b]"
              >
                View all docs
                <ArrowRight className="size-4" />
              </a>
            </div>

            <div className="grid md:grid-cols-2">
              {docsEntrypoints.map((item, index) => {
                const Icon = item.icon;
                return (
                  <a
                    className={cx(
                      "group min-h-64 border-white/10 p-5 transition hover:bg-white/[0.035]",
                      twoColumnInteriorBorders(index, docsEntrypoints.length),
                    )}
                    href={item.href}
                    key={item.title}
                  >
                    <div className="flex items-start justify-between gap-5">
                      <Icon className="size-5 text-[#e5ff1f]" />
                      <ArrowRight className="size-4 text-zinc-700 transition group-hover:translate-x-1 group-hover:text-[#e5ff1f]" />
                    </div>
                    <h3 className="mt-24 text-xl font-medium text-white">{item.title}</h3>
                    <p className="mt-3 text-sm leading-6 text-zinc-500">{item.description}</p>
                  </a>
                );
              })}
            </div>
          </div>
        </section>
      </main>
    </HomeLayout>
  );
}
