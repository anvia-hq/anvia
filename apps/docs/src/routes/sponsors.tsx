import { createFileRoute } from "@tanstack/react-router";
import { HomeLayout } from "fumadocs-ui/layouts/home";
import { ArrowUpRight, Bot, Cpu, Handshake } from "lucide-react";
import { baseOptions } from "@/lib/layout.shared";

export const Route = createFileRoute("/sponsors")({
  component: Page,
  head: () => ({
    meta: [
      {
        title: "Sponsors - Anvia",
      },
      {
        name: "description",
        content:
          "Sponsors helping Anvia development with AI token credits, infrastructure, and production feedback.",
      },
    ],
  }),
});

const sponsors = [
  {
    name: "JATEVO.AI",
    label: "Founding sponsor",
    contribution: "AI token credits for development and testing",
    description:
      "jatevo.ai provides AI token credits that help Anvia run experiments, validate examples, test provider integrations, and improve agent development workflows.",
    href: "https://jatevo.ai?ref=https://anvia.dev",
    cta: "Visit sponsor",
    logo: "/assets/jatevo-og.png",
  },
];

const supportAreas = [
  {
    title: "Provider testing",
    description:
      "Credits make it practical to run examples and compatibility checks against realistic model workloads.",
    icon: Cpu,
  },
  {
    title: "Agent examples",
    description:
      "Sponsor support keeps harness patterns, docs, and examples grounded in real model behavior.",
    icon: Bot,
  },
  {
    title: "Open development",
    description:
      "Support helps Anvia keep production patterns documented and accessible to TypeScript teams.",
    icon: Handshake,
  },
];

function Page() {
  return (
    <HomeLayout {...baseOptions}>
      <main className="anvia-landing min-h-screen bg-[#050505] text-zinc-100">
        <section className="relative overflow-hidden border-b border-white/10">
          <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,.055)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.055)_1px,transparent_1px)] bg-[length:84px_84px] opacity-30" />
          <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(5,5,5,1)_0%,rgba(5,5,5,.98)_42%,rgba(5,5,5,.9)_100%)]" />

          <div className="relative mx-auto flex min-h-[420px] max-w-7xl flex-col items-center justify-center border-x border-white/10 bg-[#050505]/92 px-6 py-16 text-center sm:px-10 lg:min-h-[520px] lg:px-12 lg:py-20">
            <p className="font-mono text-xs uppercase tracking-[0.22em] text-[#e5ff1f]">Sponsors</p>
            <h1 className="mt-6 max-w-3xl text-balance text-4xl font-semibold leading-tight tracking-normal text-white sm:text-5xl lg:text-6xl">
              Companies helping Anvia move faster.
            </h1>
            <p className="mt-5 max-w-2xl text-balance text-base leading-8 text-zinc-500">
              Anvia is supported by companies that contribute credits, infrastructure, and feedback
              for production AI development.
            </p>
          </div>
        </section>

        <section className="border-b border-white/10">
          <div className="mx-auto max-w-7xl border-x border-white/10">
            {sponsors.map((sponsor, index) => (
              <article
                className="grid border-b border-white/10 lg:grid-cols-[0.56fr_1.44fr]"
                key={sponsor.href}
              >
                <div className="border-b border-white/10 p-6 sm:p-8 lg:border-b-0 lg:border-r lg:p-8">
                  <div className="flex items-start justify-between gap-6">
                    <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-[#e5ff1f]">
                      {sponsor.label}
                    </p>
                    <span className="font-mono text-xs text-zinc-700">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                  </div>
                  <h2 className="mt-10 flex items-center gap-4 font-mono text-3xl font-semibold uppercase tracking-normal text-white sm:text-4xl">
                    <img
                      src={sponsor.logo}
                      alt=""
                      className="size-10 shrink-0 border border-white/10 bg-white object-cover sm:size-12"
                    />
                    {sponsor.name}
                  </h2>
                </div>

                <div className="flex min-h-64 flex-col justify-between p-6 sm:p-8 lg:p-8">
                  <div>
                    <p className="max-w-2xl text-base leading-8 text-zinc-100">
                      {sponsor.contribution}
                    </p>
                    <p className="mt-5 max-w-2xl text-base leading-8 text-zinc-500">
                      {sponsor.description}
                    </p>
                  </div>

                  <a
                    className="mt-8 inline-flex w-fit items-center gap-2 text-sm font-medium text-[#e5ff1f] transition hover:text-white"
                    href={sponsor.href}
                    rel="noreferrer"
                    target="_blank"
                  >
                    {sponsor.cta}
                    <ArrowUpRight className="size-4" />
                  </a>
                </div>
              </article>
            ))}

            <div className="flex flex-col gap-4 p-6 text-sm leading-7 text-zinc-500 sm:flex-row sm:items-center sm:justify-between sm:p-8">
              <p>Interested in supporting Anvia?</p>
              <a
                className="inline-flex w-fit items-center gap-2 font-medium text-[#e5ff1f] transition hover:text-white"
                href="mailto:hello@anvia.dev"
              >
                Contact hello@anvia.dev
                <ArrowUpRight className="size-4" />
              </a>
            </div>
          </div>
        </section>

        <section>
          <div className="mx-auto grid max-w-7xl border-x border-white/10 md:grid-cols-3">
            {supportAreas.map((area, index) => {
              const Icon = area.icon;
              return (
                <article
                  className={[
                    "min-h-72 border-white/10 p-6 sm:p-8 lg:p-10",
                    index < supportAreas.length - 1 ? "border-b md:border-b-0 md:border-r" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  key={area.title}
                >
                  <Icon className="size-5 text-[#e5ff1f]" />
                  <h3 className="mt-16 text-2xl font-medium tracking-normal text-white">
                    {area.title}
                  </h3>
                  <p className="mt-4 text-sm leading-7 text-zinc-500">{area.description}</p>
                </article>
              );
            })}
          </div>
        </section>
      </main>
    </HomeLayout>
  );
}
