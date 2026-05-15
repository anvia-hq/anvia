import { useEffect, useId, useState } from "react";

type MermaidProps = {
  chart: string;
};

type MermaidStatus =
  | { state: "loading" }
  | { state: "ready"; svg: string }
  | { state: "error"; message: string };

export function Mermaid({ chart }: MermaidProps) {
  const id = useId();
  const [status, setStatus] = useState<MermaidStatus>({ state: "loading" });

  useEffect(() => {
    let cancelled = false;
    const renderId = `mermaid-${id.replace(/[^a-zA-Z0-9_-]/g, "")}`;

    async function renderDiagram() {
      try {
        const mermaid = (await import("mermaid")).default;

        mermaid.initialize({
          startOnLoad: false,
          theme: "default",
          securityLevel: "strict",
        });

        const { svg } = await mermaid.render(renderId, chart);

        if (!cancelled) {
          setStatus({ state: "ready", svg });
        }
      } catch (error) {
        if (!cancelled) {
          setStatus({
            state: "error",
            message: error instanceof Error ? error.message : "Unable to render diagram.",
          });
        }
      }
    }

    setStatus({ state: "loading" });
    void renderDiagram();

    return () => {
      cancelled = true;
    };
  }, [chart, id]);

  if (status.state === "ready") {
    return (
      <div
        className="my-6 overflow-x-auto rounded-lg border bg-fd-card p-4"
        // biome-ignore lint/security/noDangerouslySetInnerHtml: Mermaid returns SVG markup; securityLevel strict keeps user-authored HTML disabled.
        dangerouslySetInnerHTML={{ __html: status.svg }}
      />
    );
  }

  if (status.state === "error") {
    return (
      <pre className="my-6 overflow-x-auto rounded-lg border bg-fd-card p-4 text-sm">
        <code>{`${status.message}\n\n${chart}`}</code>
      </pre>
    );
  }

  return (
    <div className="my-6 rounded-lg border bg-fd-card p-4 text-sm text-fd-muted-foreground">
      Loading diagram...
    </div>
  );
}
