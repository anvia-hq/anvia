import type { ActivePage, PageLocation } from "./types";

const root = document.getElementById("anvia-ui");
const uiPath = root?.dataset.uiPath ?? "/ui";
const compatUiPath = root?.dataset.uiCompatPath ?? "/ui";
const assetPath = normalizePathPrefix(uiPath) || normalizePathPrefix(compatUiPath) || "/ui";

export const logoSrc = `${assetPath}/assets/logo.png`;

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
      return {
        page: "tracing",
        ...(third === undefined ? {} : { traceSessionId: third }),
      };
    }
    return {
      page: "tracing",
      ...(second === undefined ? {} : { traceId: second }),
    };
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
  if (first === "knowledge") {
    return { page: "knowledge" };
  }
  if (first === "playground") {
    return {
      page: "playground",
      ...(second === undefined ? {} : { sessionId: second }),
    };
  }
  if (first !== undefined && second === undefined) {
    return { page: "playground", sessionId: first };
  }
  return { page: "playground" };
}

export function updatePagePath(page: ActivePage): void {
  const normalizedUiPath = normalizePathPrefix(uiPath);
  const normalizedCompatUiPath = normalizePathPrefix(compatUiPath) || "/ui";
  if (
    normalizedUiPath.length === 0 &&
    (page === "sessions" ||
      page === "agents" ||
      page === "tools" ||
      page === "mcps" ||
      page === "pipelines" ||
      page === "knowledge")
  ) {
    updateLocationPath(`${normalizedCompatUiPath}/${page}`);
    return;
  }
  const nextPath =
    page === "playground" ? `${normalizedUiPath}/playground` : `${normalizedUiPath}/${page}`;
  updateLocationPath(nextPath);
}

export function updateSessionPath(sessionId: string | undefined): void {
  const normalizedUiPath = normalizePathPrefix(uiPath);
  const nextPath =
    sessionId === undefined
      ? `${normalizedUiPath}/playground`
      : `${normalizedUiPath}/playground/${encodeURIComponent(sessionId)}`;
  updateLocationPath(nextPath);
}

export function updateTracePath(traceId: string): void {
  const normalizedUiPath = normalizePathPrefix(uiPath);
  updateLocationPath(`${normalizedUiPath}/tracing/${encodeURIComponent(traceId)}`);
}

export function updateTraceSessionPath(sessionId: string): void {
  const normalizedUiPath = normalizePathPrefix(uiPath);
  updateLocationPath(`${normalizedUiPath}/tracing/sessions/${encodeURIComponent(sessionId)}`);
}

export function normalizePathPrefix(path: string): string {
  return path === "/" ? "" : path.replace(/\/+$/, "");
}

function updateLocationPath(nextPath: string): void {
  const nextUrl = `${nextPath}${window.location.search}${window.location.hash}`;
  if (`${window.location.pathname}${window.location.search}${window.location.hash}` === nextUrl) {
    return;
  }
  window.history.pushState({}, "", nextUrl);
}
