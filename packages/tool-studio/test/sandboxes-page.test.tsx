// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SandboxesPage } from "../src/ui/app/modules/sandboxes/sandboxes-page";

describe("SandboxesPage", () => {
  let container: HTMLDivElement;
  let root: Root;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url === "/sandboxes") {
        return jsonResponse({
          sandboxes: [
            {
              ref: "sandbox_ref",
              id: "workspace_1",
              provider: "docker",
              workdir: "/workspace",
              agentIds: ["coder"],
              toolNames: ["list_files", "read_file"],
              capabilities: { files: true, ports: true, processes: true },
            },
          ],
        });
      }
      if (url.includes("/files/content?")) {
        return new Response("<script>globalThis.compromised = true</script>", {
          headers: { "content-type": "application/octet-stream" },
        });
      }
      if (url.includes("/files?")) {
        return jsonResponse({
          sandboxRef: "sandbox_ref",
          path: ".",
          entries: [
            { path: "src", type: "directory", size: 0 },
            { path: "readme.txt", type: "file", size: 18 },
          ],
        });
      }
      if (url.endsWith("/ports")) {
        return jsonResponse({
          sandboxRef: "sandbox_ref",
          ports: [{ containerPort: 5173, host: "127.0.0.1", hostPort: 49152, protocol: "tcp" }],
        });
      }
      if (url.endsWith("/processes")) {
        return jsonResponse({
          sandboxRef: "sandbox_ref",
          processes: [
            {
              id: "process_1",
              command: "pnpm",
              args: ["dev"],
              status: "running",
              startedAt: "2026-07-17T00:00:00.000Z",
            },
          ],
        });
      }
      if (url.includes("/processes/process_1/logs")) {
        return jsonResponse({
          sandboxRef: "sandbox_ref",
          processId: "process_1",
          stdout: "ready",
          stderr: "",
          stdoutTruncated: false,
          stderrTruncated: false,
        });
      }
      return new Response(null, { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("browses discovered files and inspects read-only runtime state", async () => {
    const onError = vi.fn();
    act(() =>
      root.render(
        <SandboxesPage
          enabled
          initialSandboxRef="sandbox_ref"
          onError={onError}
          onSelectSandbox={vi.fn()}
        />,
      ),
    );

    await vi.waitFor(() => expect(container.textContent).toContain("workspace_1"));
    expect(container.textContent).toContain("readme.txt");
    expect(container.textContent).toContain("5173/tcp");
    expect(container.textContent).toContain("pnpm dev");

    const readme = findButton("readme.txt");
    act(() => readme.click());
    await vi.waitFor(() => expect(container.textContent).toContain("globalThis.compromised"));
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector('a[href*="download=1"]')).not.toBeNull();

    const process = findButton("pnpm dev");
    act(() => process.click());
    await vi.waitFor(() => expect(container.textContent).toContain("ready"));
    expect(onError).not.toHaveBeenCalled();

    const refresh = findButton("Refresh");
    act(() => refresh.click());
    await vi.waitFor(() => {
      expect(fetchMock.mock.calls.filter(([url]) => String(url) === "/sandboxes")).toHaveLength(2);
    });
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes("/files?"))).toHaveLength(2);
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/ports"))).toHaveLength(2);
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/processes"))).toHaveLength(
      2,
    );
  });

  function findButton(text: string): HTMLButtonElement {
    const button = [...container.querySelectorAll("button")].find((item) =>
      item.textContent?.includes(text),
    );
    if (!(button instanceof HTMLButtonElement)) {
      throw new Error(`Button not found: ${text}`);
    }
    return button;
  }
});

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
  });
}
