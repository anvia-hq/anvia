import { notFound, useLocation } from "@tanstack/react-router";
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
  { title: "Models", href: "/docs/models" },
  { title: "Studio", href: "/docs/studio/overview" },
  { title: "Reference", href: "/docs/reference" },
];

export const docsServerLoader = createServerFn({ method: "GET" })
  .inputValidator((slugs: string[]) => slugs)
  .handler(async ({ data: slugs }) => {
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
          <a aria-current={active ? "page" : undefined} href={section.href} key={section.href}>
            {section.title}
          </a>
        );
      })}
    </nav>
  );
}
