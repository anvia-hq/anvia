import { useCallback, useEffect, useState } from "react";

export type StudioTheme = "light" | "dark";
export type ResolvedStudioTheme = StudioTheme;

const studioThemeStorageKey = "anvia-theme";
const legacyStudioThemeStorageKey = "anvia-studio-theme";

export function readInitialStudioTheme(): StudioTheme {
  if (typeof window === "undefined") {
    return "dark";
  }
  try {
    const stored = window.localStorage.getItem(studioThemeStorageKey);
    if (stored === "light" || stored === "dark") {
      return stored;
    }
    const legacy = window.localStorage.getItem(legacyStudioThemeStorageKey);
    return legacy === "light" || legacy === "dark" ? legacy : "dark";
  } catch {
    return "dark";
  }
}

export function resolveStudioTheme(theme: StudioTheme): ResolvedStudioTheme {
  return theme;
}

export function nextStudioTheme(theme: StudioTheme): StudioTheme {
  return theme === "light" ? "dark" : "light";
}

export function applyStudioTheme(theme: ResolvedStudioTheme): void {
  if (typeof document === "undefined") {
    return;
  }
  const root = document.documentElement;
  root.classList.toggle("dark", theme === "dark");
  root.dataset.theme = theme;
  root.style.colorScheme = theme;
  document
    .querySelector<HTMLMetaElement>('meta[name="theme-color"]')
    ?.setAttribute("content", theme === "dark" ? "#09090b" : "#f4f4f5");
  const favicon = document.querySelector<HTMLLinkElement>("link[data-anvia-favicon]");
  if (favicon !== null) {
    favicon.href = studioAssetPath(`favicon-${theme}.svg`);
  }
}

export function storeStudioTheme(theme: StudioTheme): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(studioThemeStorageKey, theme);
  } catch {
    // Ignore storage failures so private or restricted browsing still toggles the UI.
  }
}

function studioAssetPath(asset: string): string {
  const uiRoot = document.getElementById("anvia-ui");
  const base = uiRoot?.dataset.uiCompatPath ?? "/ui";
  return `${base.replace(/\/$/, "")}/assets/${asset}`;
}

function isEditableTarget(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    (target.matches("input, textarea, select") ||
      target.closest("[contenteditable]:not([contenteditable='false'])") !== null)
  );
}

export const initialStudioTheme = readInitialStudioTheme();
applyStudioTheme(initialStudioTheme);

export function useStudioTheme(): {
  theme: StudioTheme;
  resolvedTheme: ResolvedStudioTheme;
  toggleTheme: () => void;
} {
  const [theme, setTheme] = useState<StudioTheme>(() => initialStudioTheme);
  const toggleTheme = useCallback(() => setTheme((current) => nextStudioTheme(current)), []);

  useEffect(() => {
    applyStudioTheme(theme);
    storeStudioTheme(theme);
  }, [theme]);

  useEffect(() => {
    const toggleWithShortcut = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.repeat ||
        event.key.toLowerCase() !== "d" ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        isEditableTarget(event.target)
      ) {
        return;
      }
      toggleTheme();
    };
    window.addEventListener("keydown", toggleWithShortcut);
    return () => window.removeEventListener("keydown", toggleWithShortcut);
  }, [toggleTheme]);

  return {
    theme,
    resolvedTheme: resolveStudioTheme(theme),
    toggleTheme,
  };
}
