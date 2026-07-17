import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import {
  isStudioUiEnabled,
  registerStudioUi,
  resolveStudioUiOptions,
  studioUiEntryPath,
} from "../src/ui/routes";

describe("Studio UI routes", () => {
  it("resolves UI options with normalized defaults", () => {
    expect(isStudioUiEnabled(undefined)).toBe(true);
    expect(isStudioUiEnabled(false)).toBe(false);
    const defaults = resolveStudioUiOptions(undefined);
    expect(defaults).toEqual({
      path: "/ui",
      title: "Anvia Studio",
      rootRoutes: true,
      redirectRoot: true,
      protectShell: false,
    });
    expect(defaults).not.toHaveProperty("clientScript");
    expect(
      resolveStudioUiOptions({
        path: "studio///",
        title: "Ops <Studio>",
        rootRoutes: false,
        redirectRoot: false,
        clientScript: "console.log('studio')",
        protectShell: true,
      }),
    ).toEqual({
      path: "/studio",
      title: "Ops <Studio>",
      rootRoutes: false,
      redirectRoot: false,
      clientScript: "console.log('studio')",
      protectShell: true,
    });
    expect(resolveStudioUiOptions({ path: "/" }).path).toBe("/ui");
  });

  it("registers root shell routes and redirects configured page paths", async () => {
    const app = new Hono();
    const options = resolveStudioUiOptions({
      path: "/studio",
      title: "Ops <Studio>",
      clientScript: "console.log('studio')",
    });
    registerStudioUi(app, options);

    const redirect = await app.request("http://studio.test/");
    expect(redirect.status).toBe(302);
    expect(redirect.headers.get("location")).toBe(studioUiEntryPath(options));

    const legacy = await app.request("http://studio.test/studio/tracing/trace_1?panel=events");
    expect(legacy.status).toBe(302);
    expect(legacy.headers.get("location")).toBe("/tracing/trace_1?panel=events");

    const shell = await app.request("http://studio.test/tracing/trace_1");
    expect(shell.status).toBe(200);
    expect(shell.headers.get("content-type")).toContain("text/html");
    const shellHtml = await shell.text();
    expect(shellHtml).toContain("<title>Ops &lt;Studio&gt;</title>");
    expect(shellHtml).toContain('data-ui-path=""');
    expect(shellHtml).toContain('data-ui-compat-path="/studio"');
    expect(shellHtml).toContain('src="/studio/assets/client.js"');

    const rootShell = await app.request("http://studio.test/tracing/sessions/session_1");
    expect(rootShell.status).toBe(200);
    expect(await rootShell.text()).toContain('data-ui-path=""');

    const sandboxRedirect = await app.request("http://studio.test/studio/sandboxes/sandbox_ref");
    expect(sandboxRedirect.status).toBe(302);
    expect(sandboxRedirect.headers.get("location")).toBe("/sandboxes/sandbox_ref");

    const sandboxShell = await app.request("http://studio.test/sandboxes/sandbox_ref", {
      headers: { accept: "text/html" },
    });
    expect(sandboxShell.status).toBe(200);
    expect(await sandboxShell.text()).toContain('data-ui-path=""');
  });

  it("serves configured client scripts and bundled assets", async () => {
    const app = new Hono();
    registerStudioUi(
      app,
      resolveStudioUiOptions({
        path: "/studio",
        clientScript: "window.__studio = true;",
      }),
    );

    const script = await app.request("http://studio.test/studio/assets/client.js");
    expect(script.status).toBe(200);
    expect(script.headers.get("content-type")).toContain("text/javascript");
    expect(await script.text()).toBe("window.__studio = true;");

    const stylesheet = await app.request("http://studio.test/studio/assets/styles.css");
    expect(stylesheet.status).toBe(200);
    expect(stylesheet.headers.get("content-type")).toContain("text/css");

    const image = await app.request("http://studio.test/studio/assets/logo.png");
    expect(image.status).toBe(200);
    expect(image.headers.get("content-type")).toBe("image/png");
    expect((await image.arrayBuffer()).byteLength).toBeGreaterThan(0);

    const missing = await app.request("http://studio.test/studio/assets/missing.bin");
    expect(missing.status).toBe(404);
  });

  it("honors rootRoutes false while configured page paths redirect", async () => {
    const app = new Hono();
    registerStudioUi(
      app,
      resolveStudioUiOptions({
        path: "/studio",
        rootRoutes: false,
        redirectRoot: false,
      }),
    );

    expect((await app.request("http://studio.test/")).status).toBe(404);
    expect((await app.request("http://studio.test/tracing")).status).toBe(404);
    expect((await app.request("http://studio.test/studio/assets/client.js")).status).toBe(404);

    const legacy = await app.request(
      "http://studio.test/studio/knowledge/dynamic-context?agent=chef",
    );
    expect(legacy.status).toBe(302);
    expect(legacy.headers.get("location")).toBe("/knowledge/dynamic-context?agent=chef");

    expect((await app.request("http://studio.test/knowledge/dynamic-context")).status).toBe(404);
  });
});
