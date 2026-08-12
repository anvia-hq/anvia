import { useEffect, useState } from "react";

export type StudioTheme = "system" | "light" | "dark";
export type ResolvedStudioTheme = "light" | "dark";

const studioThemeStorageKey = "anvia-studio-theme";
const darkModeQuery = "(prefers-color-scheme: dark)";

export function readInitialStudioTheme(): StudioTheme {
  if (typeof window === "undefined") {
    return "system";
  }
  try {
    const stored = window.localStorage.getItem(studioThemeStorageKey);
    return stored === "light" || stored === "dark" || stored === "system" ? stored : "system";
  } catch {
    return "system";
  }
}

export function resolveStudioTheme(
  theme: StudioTheme,
  prefersDark = systemPrefersDark(),
): ResolvedStudioTheme {
  return theme === "system" ? (prefersDark ? "dark" : "light") : theme;
}

export function nextStudioTheme(theme: StudioTheme): StudioTheme {
  return theme === "system" ? "light" : theme === "light" ? "dark" : "system";
}

export function applyStudioTheme(theme: ResolvedStudioTheme): void {
  if (typeof document === "undefined") {
    return;
  }
  document.documentElement.classList.toggle("dark", theme === "dark");
  document.documentElement.style.colorScheme = theme;
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

function systemPrefersDark(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia(darkModeQuery).matches
  );
}

export const initialStudioTheme = readInitialStudioTheme();
applyStudioTheme(resolveStudioTheme(initialStudioTheme));

export function useStudioTheme(): {
  theme: StudioTheme;
  resolvedTheme: ResolvedStudioTheme;
  toggleTheme: () => void;
} {
  const [theme, setTheme] = useState<StudioTheme>(() => initialStudioTheme);
  const [prefersDark, setPrefersDark] = useState(systemPrefersDark);
  const resolvedTheme = resolveStudioTheme(theme, prefersDark);

  useEffect(() => {
    if (typeof window.matchMedia !== "function") {
      return;
    }
    const media = window.matchMedia(darkModeQuery);
    const update = (event: MediaQueryListEvent) => setPrefersDark(event.matches);
    setPrefersDark(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    applyStudioTheme(resolvedTheme);
    storeStudioTheme(theme);
  }, [resolvedTheme, theme]);

  return {
    theme,
    resolvedTheme,
    toggleTheme: () => setTheme((current) => nextStudioTheme(current)),
  };
}
