import { afterEach, describe, expect, it, vi } from "vitest";
import { readInitialStudioTheme } from "../src/ui/app/app-theme";

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

  it("retains valid preferences and migrates the legacy key", () => {
    const getItem = vi.fn((key: string): string | null => (key === "anvia-theme" ? "light" : null));
    vi.stubGlobal("window", { localStorage: { getItem } });

    expect(readInitialStudioTheme()).toBe("light");
    getItem.mockImplementation((key: string) => (key === "anvia-studio-theme" ? "dark" : null));
    expect(readInitialStudioTheme()).toBe("dark");
    getItem.mockImplementation((key: string) => {
      if (key === "anvia-theme") {
        return "sepia";
      }

      if (key === "anvia-studio-theme") {
        return "light";
      }

      return null;
    });
    expect(readInitialStudioTheme()).toBe("light");
  });
});
