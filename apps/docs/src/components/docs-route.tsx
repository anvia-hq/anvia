import { Link, notFound, redirect, useLocation } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import browserCollections from "collections/browser";
import { useFumadocsLoader } from "fumadocs-core/source/client";
import { DocsLayout, useDocsLayout } from "fumadocs-ui/layouts/docs";
import { DocsBody, DocsDescription, DocsPage, DocsTitle } from "fumadocs-ui/layouts/docs/page";
import { SidebarIcon } from "lucide-react";
import { Suspense } from "react";
import { getMDXComponents } from "@/components/mdx";
import { baseOptions } from "@/lib/layout.shared";
import { source } from "@/lib/source";

const docsSections = [
  { title: "Docs", href: "/docs/guides" },
  { title: "Best Practices", href: "/docs/best-practices" },
  { title: "Frameworks", href: "/docs/frameworks" },
  { title: "Models", href: "/docs/models" },
  { title: "Sandbox", href: "/docs/sandbox", badge: "New" },
  { title: "Studio", href: "/docs/studio/overview" },
  { title: "Reference", href: "/docs/reference" },
];

const bestPracticeRedirects: Record<string, string> = {
  "agent-structure": "/docs/best-practices/common-patterns/agent-structure",
  "backoffice-agent": "/docs/best-practices/real-cases/backoffice-agent",
  "coding-agent": "/docs/best-practices/real-cases/coding-agent",
  "context-and-memory": "/docs/best-practices/common-patterns/context-and-memory",
  "dynamic-tool-catalogs": "/docs/best-practices/tool-patterns/dynamic-tool-catalogs",
  "eval-strategy": "/docs/best-practices/quality-observability/eval-strategy",
  "harness-blueprint": "/docs/best-practices/common-patterns/harness-blueprint",
  "mcp-agent-harness": "/docs/best-practices/mcp-patterns/mcp-agent-harness",
  "mcp-server-lifecycle": "/docs/best-practices/mcp-patterns/mcp-server-lifecycle",
  "mcp-tool-inspection": "/docs/best-practices/mcp-patterns/mcp-tool-inspection",
  pipeline: "/docs/best-practices/common-patterns/pipeline",
  "production-guardrails": "/docs/best-practices/common-patterns/production-guardrails",
  "production-readiness-checklist":
    "/docs/best-practices/operations/production-readiness-checklist",
  "rag-agent-context": "/docs/best-practices/knowledge-patterns/rag-agent-context",
  "rag-ingestion": "/docs/best-practices/knowledge-patterns/rag-ingestion",
  "request-runners": "/docs/best-practices/common-patterns/request-runners",
  "research-agent": "/docs/best-practices/real-cases/research-agent",
  "side-effect-tools": "/docs/best-practices/tool-patterns/side-effect-tools",
  "support-agent": "/docs/best-practices/real-cases/support-agent",
  "testing-and-observability": "/docs/best-practices/common-patterns/testing-and-observability",
  "tool-validation-and-contracts":
    "/docs/best-practices/tool-patterns/tool-validation-and-contracts",
  "tools-and-services": "/docs/best-practices/common-patterns/tools-and-services",
  "tracing-and-debugging": "/docs/best-practices/quality-observability/tracing-and-debugging",
};

export const docsServerLoader = createServerFn({ method: "GET" })
  .inputValidator((slugs: string[]) => slugs)
  .handler(async ({ data: slugs }) => {
    const bestPracticeRedirect =
      slugs[0] === "best-practices" ? bestPracticeRedirects[slugs[1] ?? ""] : undefined;

    if (bestPracticeRedirect && slugs.length === 2) {
      throw redirect({ to: bestPracticeRedirect });
    }

    const page = source.getPage(slugs);

    if (!page) {
      throw notFound();
    }

    return {
      pageTree: await source.serializePageTree(source.getPageTree()),
      path: page.path,
    };
  });

export const docsClientLoader = browserCollections.docs.createClientLoader({
  component({ default: MDX, frontmatter, toc }) {
    return (
      <DocsPage toc={toc} full>
        <DocsTitle>{frontmatter.title}</DocsTitle>
        <DocsDescription>{frontmatter.description}</DocsDescription>
        <DocsBody>
          <MDX components={getMDXComponents()} />
        </DocsBody>
      </DocsPage>
    );
  },
});

type DocsLoaderData = Awaited<ReturnType<typeof docsServerLoader>>;

export function DocsRoutePage({ loaderData }: { loaderData: DocsLoaderData }) {
  const data = useFumadocsLoader(loaderData);

  return (
    <DocsLayout
      {...baseOptions}
      tree={data.pageTree}
      tabs={false}
      containerProps={{
        className: "docs-with-section-tabs",
      }}
      sidebar={{
        collapsible: true,
      }}
      slots={{
        header: DocsHeader,
      }}
    >
      <Suspense>{docsClientLoader.useContent(data.path)}</Suspense>
    </DocsLayout>
  );
}

function DocsHeader() {
  const { slots } = useDocsLayout();

  return (
    <header className="docs-layout-header">
      <div className="docs-mobile-header">
        {slots.navTitle ? (
          <slots.navTitle className="inline-flex items-center gap-2.5 font-semibold" />
        ) : null}
        <div className="flex-1" />
        {slots.searchTrigger ? <slots.searchTrigger.sm className="p-2" hideIfDisabled /> : null}
        {slots.sidebar ? (
          <slots.sidebar.trigger className="inline-flex size-9 items-center justify-center rounded-md text-fd-muted-foreground transition-colors hover:bg-fd-accent hover:text-fd-accent-foreground">
            <SidebarIcon className="size-4" />
          </slots.sidebar.trigger>
        ) : null}
      </div>
      <DocsSectionTabs />
    </header>
  );
}

function DocsSectionTabs() {
  const pathname = useLocation({ select: (location) => location.pathname });

  return (
    <nav aria-label="Documentation sections" className="docs-section-tabs">
      {docsSections.map((section) => {
        const active = pathname === section.href || pathname.startsWith(`${section.href}/`);

        return (
          <Link aria-current={active ? "page" : undefined} key={section.href} to={section.href}>
            <span>{section.title}</span>
            {"badge" in section ? (
              <span className="docs-section-tab-badge">{section.badge}</span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
