import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { Context, Hono, Next } from "hono";
import type { StudioUiOptions } from "../types";

export type ResolvedStudioUiOptions = {
  path: string;
  title: string;
  rootRoutes: boolean;
  redirectRoot: boolean;
  clientScript?: string;
  protectShell: boolean;
};

export function resolveStudioUiOptions(
  ui: boolean | StudioUiOptions | undefined,
): ResolvedStudioUiOptions {
  const options = typeof ui === "object" ? ui : {};
  return {
    path: normalizeUiPath(options.path ?? "/ui"),
    title: options.title ?? "Anvia Studio",
    rootRoutes: options.rootRoutes ?? true,
    redirectRoot: options.redirectRoot ?? true,
    ...(options.clientScript === undefined ? {} : { clientScript: options.clientScript }),
    protectShell: options.protectShell ?? false,
  };
}

export function isStudioUiEnabled(ui: boolean | StudioUiOptions | undefined): boolean {
  return ui !== false;
}

export function registerStudioUi(app: Hono, options: ResolvedStudioUiOptions): void {
  const scriptPath = `${options.path}/assets/client.js`;
  const stylePath = `${options.path}/assets/styles.css`;
  const renderShell = () =>
    renderStudioUi({
      options,
      routePath: "",
      clientScript: scriptPath,
      stylesheet: stylePath,
    });

  if (options.redirectRoot) {
    app.get("/", (c) => c.redirect(studioUiEntryPath(options)));
  }

  const redirectWithQuery = (c: Context, target: string) => {
    const search = new URL(c.req.url).search;
    return c.redirect(search.length === 0 ? target : `${target}${search}`);
  };

  app.get(options.path, (c) => redirectWithQuery(c, studioUiEntryPath(options)));
  app.get(`${options.path}/playground`, (c) => redirectWithQuery(c, "/playground"));
  app.get(`${options.path}/playground/:sessionId`, (c) =>
    redirectWithQuery(c, `/playground/${encodeURIComponent(c.req.param("sessionId"))}`),
  );
  app.get(`${options.path}/tracing`, (c) => redirectWithQuery(c, "/tracing"));
  app.get(`${options.path}/tracing/:traceId`, (c) =>
    redirectWithQuery(c, `/tracing/${encodeURIComponent(c.req.param("traceId"))}`),
  );
  app.get(`${options.path}/tracing/sessions/:sessionId`, (c) =>
    redirectWithQuery(c, `/tracing/sessions/${encodeURIComponent(c.req.param("sessionId"))}`),
  );
  app.get(`${options.path}/sessions`, (c) => redirectWithQuery(c, "/sessions"));
  app.get(`${options.path}/agents`, (c) => redirectWithQuery(c, "/agents"));
  app.get(`${options.path}/tools`, (c) => redirectWithQuery(c, "/tools"));
  app.get(`${options.path}/mcps`, (c) => redirectWithQuery(c, "/mcps"));
  app.get(`${options.path}/pipelines`, (c) => redirectWithQuery(c, "/pipelines"));
  app.get(`${options.path}/evals`, (c) => redirectWithQuery(c, "/evals"));
  app.get(`${options.path}/memory`, (c) => redirectWithQuery(c, "/memory"));
  app.get(`${options.path}/status`, (c) => redirectWithQuery(c, "/status"));
  app.get(`${options.path}/knowledge`, (c) => redirectWithQuery(c, "/knowledge"));
  app.get(`${options.path}/knowledge/:tab`, (c) =>
    redirectWithQuery(c, `/knowledge/${encodeURIComponent(c.req.param("tab"))}`),
  );

  if (options.rootRoutes) {
    app.get("/playground", async (c) => c.html(await renderShell()));
    app.get("/playground/:sessionId", async (c) => c.html(await renderShell()));
    app.get("/tracing", async (c) => c.html(await renderShell()));
    app.get("/tracing/:traceId", async (c) => c.html(await renderShell()));
    app.get("/tracing/sessions/:sessionId", async (c) => c.html(await renderShell()));
    app.get("/tracing/*", async (c) => c.html(await renderShell()));
    app.get("/sessions", shellWhenHtml(renderShell));
    app.get("/agents", shellWhenHtml(renderShell));
    app.get("/tools", async (c) => c.html(await renderShell()));
    app.get("/mcps", async (c) => c.html(await renderShell()));
    app.get("/pipelines", shellWhenHtml(renderShell));
    app.get("/evals", shellWhenHtml(renderShell));
    app.get("/memory", async (c) => c.html(await renderShell()));
    app.get("/status", shellWhenHtml(renderShell));
    app.get("/knowledge", shellWhenHtml(renderShell));
    app.get("/knowledge/:tab", shellWhenKnowledgeTab(renderShell));
    app.get("/knowledge/*", shellWhenHtml(renderShell));
  }

  app.get(scriptPath, async () => {
    if (options.clientScript === undefined) {
      return new Response(null, { status: 404 });
    }
    return new Response(options.clientScript, {
      headers: {
        "content-type": "text/javascript; charset=utf-8",
        "cache-control": "no-cache",
      },
    });
  });

  app.get(stylePath, async () => {
    const source = await readBundledLegacyStylesheet();
    return new Response(source, {
      headers: {
        "content-type": "text/css; charset=utf-8",
        "cache-control": "no-cache",
      },
    });
  });

  app.get(`${options.path}/assets/:asset`, async (c) => {
    const asset = c.req.param("asset");
    if (asset.includes("/") || asset.includes("..")) {
      return new Response(null, { status: 404 });
    }
    const source = await readBundledUiAsset(asset);
    if (source === undefined) {
      return new Response(null, { status: 404 });
    }
    const body = new ArrayBuffer(source.byteLength);
    new Uint8Array(body).set(source);
    return new Response(body, {
      headers: {
        "content-type": contentTypeForAsset(asset),
        "cache-control": "no-cache",
      },
    });
  });
}

function shellWhenHtml(renderShell: () => Promise<string>) {
  return async (c: Context, next: Next) => {
    const accept = c.req.header("accept") ?? "";
    if (!accept.includes("text/html")) {
      return next();
    }
    return c.html(await renderShell());
  };
}

function shellWhenKnowledgeTab(renderShell: () => Promise<string>) {
  return async (c: Context, next: Next) => {
    if (!isKnowledgeTabRoute(c.req.param("tab"))) {
      return next();
    }
    return c.html(await renderShell());
  };
}

function isKnowledgeTabRoute(tab: string | undefined): boolean {
  return (
    tab === "static-context" ||
    tab === "dynamic-context" ||
    tab === "dynamic-tools" ||
    tab === "retrieval-log"
  );
}

async function renderStudioUi(props: {
  options: ResolvedStudioUiOptions;
  routePath: string;
  clientScript: string;
  stylesheet: string;
}): Promise<string> {
  const { options } = props;
  if (options.clientScript !== undefined) {
    return renderLegacyStudioUiShell({
      title: options.title,
      uiPath: props.routePath,
      compatUiPath: options.path,
      clientScript: props.clientScript,
      stylesheet: props.stylesheet,
    });
  }
  const index = await readBundledUiIndex();
  return index
    .replace(/<title>.*?<\/title>/, `<title>${escapeHtml(options.title)}</title>`)
    .replace(
      'data-ui-path="/ui"',
      `data-ui-path="${escapeHtml(props.routePath)}" data-ui-compat-path="${escapeHtml(options.path)}"`,
    )
    .replaceAll('"/ui/', `"${escapeHtml(options.path)}/`);
}

function renderLegacyStudioUiShell(props: {
  title: string;
  uiPath: string;
  compatUiPath: string;
  clientScript: string;
  stylesheet: string;
}): string {
  const title = escapeHtml(props.title);
  return [
    "<!doctype html>",
    '<html lang="en" class="dark">',
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${title}</title>`,
    '<script>(()=>{try{if(localStorage.getItem("anvia-studio-theme")==="light"){document.documentElement.classList.remove("dark")}}catch{}})();</script>',
    `<link rel="icon" type="image/png" href="${escapeHtml(props.compatUiPath)}/assets/logo.png">`,
    `<link rel="stylesheet" href="${escapeHtml(props.stylesheet)}">`,
    "</head>",
    "<body>",
    `<div id="anvia-ui" data-ui-path="${escapeHtml(props.uiPath)}" data-ui-compat-path="${escapeHtml(props.compatUiPath)}">`,
    '<main class="shell-loading">',
    "<div>",
    `<img src="${escapeHtml(props.compatUiPath)}/assets/logo.png" alt="" width="32" height="32">`,
    '<p class="eyebrow">Anvia</p>',
    `<h1>${title}</h1>`,
    "</div>",
    "</main>",
    "</div>",
    `<script type="module" src="${escapeHtml(props.clientScript)}"></script>`,
    "</body>",
    "</html>",
  ].join("");
}

function normalizeUiPath(path: string): string {
  const trimmed = path.trim();
  const withSlash = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  const withoutTrailingSlash = withSlash.length > 1 ? withSlash.replace(/\/+$/, "") : withSlash;
  if (withoutTrailingSlash.length === 0 || withoutTrailingSlash === "/") {
    return "/ui";
  }
  return withoutTrailingSlash;
}

export function studioUiEntryPath(_options: ResolvedStudioUiOptions): string {
  return "/playground";
}

async function readBundledUiIndex(): Promise<string> {
  try {
    return await readFile(fileURLToPath(new URL("./ui/index.html", import.meta.url)), "utf8");
  } catch (error) {
    if (!isNotFoundError(error)) {
      throw error;
    }
  }
  try {
    return await readFile(
      fileURLToPath(new URL("../../dist/ui/index.html", import.meta.url)),
      "utf8",
    );
  } catch (error) {
    if (!isNotFoundError(error)) {
      throw error;
    }
    return readFile(fileURLToPath(new URL("./app/index.html", import.meta.url)), "utf8");
  }
}

async function readBundledUiAsset(asset: string): Promise<Uint8Array | undefined> {
  try {
    return await readFile(fileURLToPath(new URL(`./assets/${asset}`, import.meta.url)));
  } catch (sourceError) {
    if (!isNotFoundError(sourceError)) {
      throw sourceError;
    }
  }
  try {
    return await readFile(fileURLToPath(new URL(`./ui/assets/${asset}`, import.meta.url)));
  } catch (error) {
    if (!isNotFoundError(error)) {
      throw error;
    }
    try {
      return await readFile(
        fileURLToPath(new URL(`../../dist/ui/assets/${asset}`, import.meta.url)),
      );
    } catch (fallbackError) {
      if (!isNotFoundError(fallbackError)) {
        throw fallbackError;
      }
      return undefined;
    }
  }
}

async function readBundledLegacyStylesheet(): Promise<string> {
  try {
    return await readFile(fileURLToPath(new URL("./ui/styles.css", import.meta.url)), "utf8");
  } catch (error) {
    if (!isNotFoundError(error)) {
      throw error;
    }
    try {
      return await readFile(
        fileURLToPath(new URL("../../dist/ui/styles.css", import.meta.url)),
        "utf8",
      );
    } catch (fallbackError) {
      if (!isNotFoundError(fallbackError)) {
        throw fallbackError;
      }
      return "";
    }
  }
}

function isNotFoundError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}

function contentTypeForAsset(asset: string): string {
  if (asset.endsWith(".js")) {
    return "text/javascript; charset=utf-8";
  }
  if (asset.endsWith(".css")) {
    return "text/css; charset=utf-8";
  }
  if (asset.endsWith(".svg")) {
    return "image/svg+xml";
  }
  if (asset.endsWith(".png")) {
    return "image/png";
  }
  if (asset.endsWith(".woff2")) {
    return "font/woff2";
  }
  return "application/octet-stream";
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}
