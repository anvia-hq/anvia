import { afterEach, describe, expect, it, vi } from "vitest";
import {
  applyStudioTheme,
  nextStudioTheme,
  readInitialStudioTheme,
  resolveStudioTheme,
  storeStudioTheme,
} from "../src/ui/app/app-theme";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Studio theme", () => {
  it("defaults invalid or missing preferences to dark", () => {
    const getItem = vi.fn().mockReturnValue(null);
    vi.stubGlobal("window", { localStorage: { getItem } });

    expect(readInitialStudioTheme()).toBe("dark");
    getItem.mockReturnValue("sepia");
    expect(readInitialStudioTheme()).toBe("dark");
  });

  it("retains valid preferences, migrates the legacy key, and toggles both modes", () => {
    const getItem = vi.fn((key: string): string | null => (key === "anvia-theme" ? "light" : null));
    const setItem = vi.fn();
    vi.stubGlobal("window", { localStorage: { getItem, setItem } });

    expect(readInitialStudioTheme()).toBe("light");
    getItem.mockImplementation((key: string) => (key === "anvia-studio-theme" ? "dark" : null));
    expect(readInitialStudioTheme()).toBe("dark");
    getItem.mockImplementation((key: string) =>
      key === "anvia-theme" ? "sepia" : key === "anvia-studio-theme" ? "light" : null,
    );
    expect(readInitialStudioTheme()).toBe("light");
    expect(nextStudioTheme("light")).toBe("dark");
    expect(nextStudioTheme("dark")).toBe("light");
    storeStudioTheme("dark");
    expect(setItem).toHaveBeenCalledWith("anvia-theme", "dark");
  });

  it("resolves and applies theme chrome", () => {
    expect(resolveStudioTheme("dark")).toBe("dark");
    expect(resolveStudioTheme("light")).toBe("light");

    const toggle = vi.fn();
    const dataset: Record<string, string> = {};
    const style: { colorScheme?: string } = {};
    const meta = { setAttribute: vi.fn() };
    const favicon = { href: "" };
    vi.stubGlobal("document", {
      documentElement: { classList: { toggle }, dataset, style },
      getElementById: vi.fn().mockReturnValue(null),
      querySelector: vi.fn((selector: string) => (selector.startsWith("meta") ? meta : favicon)),
    });
    applyStudioTheme("dark");
    expect(toggle).toHaveBeenCalledWith("dark", true);
    expect(dataset.theme).toBe("dark");
    expect(style.colorScheme).toBe("dark");
    expect(meta.setAttribute).toHaveBeenCalledWith("content", "#09090b");
    expect(favicon.href).toBe("/ui/assets/favicon-dark.svg");
  });
});
