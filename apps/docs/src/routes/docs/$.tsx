import { createFileRoute } from "@tanstack/react-router";
import { DocsRoutePage, docsClientLoader, docsServerLoader } from "@/components/docs-route";

export const Route = createFileRoute("/docs/$")({
  component: Page,
  loader: async ({ params }) => {
    const slugs = params._splat?.split("/") ?? [];
    const data = await docsServerLoader({ data: slugs });

    await docsClientLoader.preload(data.path);

    return data;
  },
});

function Page() {
  return <DocsRoutePage loaderData={Route.useLoaderData()} />;
}
