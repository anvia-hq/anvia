import { useNavigate, useParams } from "@tanstack/react-router";
import { Suspense } from "react";
import { PageLoading, SandboxesPage } from "../app-pages";
import { useActivatedRoute } from "./route-helpers";

export function SandboxesRoute() {
  const studio = useActivatedRoute("sandboxes");
  const params = useParams({ strict: false }) as { sandboxRef?: string };
  const navigate = useNavigate();
  const pageProps: { initialSandboxRef?: string } = {};
  if (params.sandboxRef !== undefined) pageProps.initialSandboxRef = params.sandboxRef;

  return (
    <Suspense fallback={<PageLoading />}>
      <SandboxesPage
        enabled={studio.sandboxesEnabled}
        onError={studio.setError}
        onSelectSandbox={(sandboxRef) => {
          void navigate({
            to: "/sandboxes/$sandboxRef",
            params: { sandboxRef },
          });
        }}
        {...pageProps}
      />
    </Suspense>
  );
}
