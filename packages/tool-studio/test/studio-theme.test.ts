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
  it("defaults invalid or missing preferences to system", () => {
    const getItem = vi.fn().mockReturnValueOnce(null).mockReturnValueOnce("sepia");
    vi.stubGlobal("window", { localStorage: { getItem } });

    expect(readInitialStudioTheme()).toBe("system");
    expect(readInitialStudioTheme()).toBe("system");
  });

  it("retains valid stored preferences and cycles all three modes", () => {
    const getItem = vi.fn().mockReturnValueOnce("light").mockReturnValueOnce("dark");
    const setItem = vi.fn();
    vi.stubGlobal("window", { localStorage: { getItem, setItem } });

    expect(readInitialStudioTheme()).toBe("light");
    expect(readInitialStudioTheme()).toBe("dark");
    expect(nextStudioTheme("system")).toBe("light");
    expect(nextStudioTheme("light")).toBe("dark");
    expect(nextStudioTheme("dark")).toBe("system");
    storeStudioTheme("system");
    expect(setItem).toHaveBeenCalledWith("anvia-studio-theme", "system");
  });

  it("resolves and applies the effective system theme", () => {
    expect(resolveStudioTheme("system", true)).toBe("dark");
    expect(resolveStudioTheme("system", false)).toBe("light");
    expect(resolveStudioTheme("light", true)).toBe("light");

    const toggle = vi.fn();
    const style: { colorScheme?: string } = {};
    vi.stubGlobal("document", { documentElement: { classList: { toggle }, style } });
    applyStudioTheme("dark");
    expect(toggle).toHaveBeenCalledWith("dark", true);
    expect(style.colorScheme).toBe("dark");
  });
});
