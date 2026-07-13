import type { ActivePage, KnowledgeTab, PageLocation } from "./types";

const root = document.getElementById("anvia-ui");
const uiPath = root?.dataset.uiPath ?? "/ui";
const compatUiPath = root?.dataset.uiCompatPath ?? "/ui";
const assetPath = normalizePathPrefix(uiPath) || normalizePathPrefix(compatUiPath) || "/ui";

export const logoSrc = `${assetPath}/assets/logo.png`;
export const defaultKnowledgeTab: KnowledgeTab = "static-context";

export function pageLocationFromLocation(): PageLocation {
  const normalizedUiPath = normalizePathPrefix(uiPath);
  const normalizedCompatUiPath = normalizePathPrefix(compatUiPath);
  const pathname = window.location.pathname.replace(/\/+$/, "");

  if (
    normalizedCompatUiPath.length > 0 &&
    (pathname === normalizedCompatUiPath || pathname.startsWith(`${normalizedCompatUiPath}/`))
  ) {
    return pageLocationFromSegments(
      pathname === normalizedCompatUiPath
        ? []
        : pathname
            .slice(normalizedCompatUiPath.length + 1)
            .split("/")
            .filter((segment) => segment.length > 0)
            .map((segment) => decodeURIComponent(segment)),
    );
  }

  if (normalizedUiPath.length === 0 && pathname.length > 0) {
    return pageLocationFromSegments(
      pathname
        .slice(1)
        .split("/")
        .filter((segment) => segment.length > 0)
        .map((segment) => decodeURIComponent(segment)),
    );
  }

  if (pathname === normalizedUiPath) {
    return { page: "playground" };
  }
  if (!pathname.startsWith(`${normalizedUiPath}/`)) {
    return { page: "playground" };
  }

  const segments = pathname
    .slice(normalizedUiPath.length + 1)
    .split("/")
    .filter((segment) => segment.length > 0)
    .map((segment) => decodeURIComponent(segment));
  return pageLocationFromSegments(segments);
}

function pageLocationFromSegments(segments: string[]): PageLocation {
  const [first, second, third] = segments;
  if (first === "tracing") {
    if (second === "sessions") {
      const location: PageLocation = { page: "tracing" };
      if (third !== undefined) location.traceSessionId = third;
      return location;
    }
    const location: PageLocation = { page: "tracing" };
    if (second !== undefined) location.traceId = second;
    return location;
  }
  if (first === "sessions") {
    return { page: "sessions" };
  }
  if (first === "agents") {
    return { page: "agents" };
  }
  if (first === "tools") {
    return { page: "tools" };
  }
  if (first === "mcps") {
    return { page: "mcps" };
  }
  if (first === "pipelines") {
    return { page: "pipelines" };
  }
  if (first === "evals") {
    return { page: "evals" };
  }
  if (first === "memory") {
    return { page: "memory" };
  }
  if (first === "status") {
    return { page: "status" };
  }
  if (first === "knowledge") {
    return { page: "knowledge", knowledgeTab: knowledgeTabFromSegment(second) };
  }
  if (first === "playground") {
    const location: PageLocation = { page: "playground" };
    if (second !== undefined) location.sessionId = second;
    return location;
  }
  if (first !== undefined && second === undefined) {
    return { page: "playground", sessionId: first };
  }
  return { page: "playground" };
}

export function updatePagePath(page: ActivePage): void {
  if (page === "knowledge") {
    updateKnowledgePath(defaultKnowledgeTab);
    return;
  }
  const basePath = canonicalUiPath();
  const nextPath = page === "playground" ? `${basePath}/playground` : `${basePath}/${page}`;
  updateLocationPath(nextPath);
}

export function updateKnowledgePath(tab: KnowledgeTab): void {
  updateLocationPath(`${canonicalUiPath()}/knowledge/${tab}`);
}

export function updateSessionPath(sessionId: string | undefined): void {
  const basePath = canonicalUiPath();
  const nextPath =
    sessionId === undefined
      ? `${basePath}/playground`
      : `${basePath}/playground/${encodeURIComponent(sessionId)}`;
  updateLocationPath(nextPath);
}

export function updateTracePath(traceId: string): void {
  updateLocationPath(`${canonicalUiPath()}/tracing/${encodeURIComponent(traceId)}`);
}

export function updateTraceSessionPath(sessionId: string): void {
  updateLocationPath(`${canonicalUiPath()}/tracing/sessions/${encodeURIComponent(sessionId)}`);
}

export function normalizePathPrefix(path: string): string {
  return path === "/" ? "" : path.replace(/\/+$/, "");
}

function canonicalUiPath(): string {
  return normalizePathPrefix(compatUiPath) || normalizePathPrefix(uiPath) || "/ui";
}

function updateLocationPath(nextPath: string): void {
  const nextUrl = `${nextPath}${window.location.search}${window.location.hash}`;
  if (`${window.location.pathname}${window.location.search}${window.location.hash}` === nextUrl) {
    return;
  }
  window.history.pushState({}, "", nextUrl);
}

function knowledgeTabFromSegment(segment: string | undefined): KnowledgeTab {
  switch (segment) {
    case "dynamic-context":
    case "dynamic-tools":
    case "retrieval-log":
    case "static-context":
      return segment;
    default:
      return defaultKnowledgeTab;
  }
}
