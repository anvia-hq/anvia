// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useStudioTheme } from "../src/ui/app/app-theme";

describe("useStudioTheme", () => {
  let container: HTMLDivElement;
  let root: Root;
  let media: MediaQueryList;
  let changeListener: ((event: MediaQueryListEvent) => void) | undefined;

  beforeEach(() => {
    window.localStorage.removeItem("anvia-studio-theme");
    media = {
      matches: false,
      media: "(prefers-color-scheme: dark)",
      onchange: null,
      addEventListener: vi.fn((_type, listener) => {
        changeListener = listener as (event: MediaQueryListEvent) => void;
      }),
      removeEventListener: vi.fn((_type, listener) => {
        if (changeListener === listener) {
          changeListener = undefined;
        }
      }),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    };
    vi.spyOn(window, "matchMedia").mockReturnValue(media);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  it("tracks system preference changes while an explicit theme is selected", () => {
    act(() => root.render(<ThemeHarness />));
    expect(container.textContent).toContain("system/light");

    act(() => container.querySelector("button")?.click());
    expect(container.textContent).toContain("light/light");

    act(() => {
      Object.defineProperty(media, "matches", { configurable: true, value: true });
      changeListener?.({ matches: true } as MediaQueryListEvent);
    });
    expect(container.textContent).toContain("light/light");

    act(() => container.querySelector("button")?.click());
    expect(container.textContent).toContain("dark/dark");

    act(() => container.querySelector("button")?.click());
    expect(container.textContent).toContain("system/dark");
  });
});

function ThemeHarness() {
  const { resolvedTheme, theme, toggleTheme } = useStudioTheme();
  return (
    <button type="button" onClick={toggleTheme}>
      {theme}/{resolvedTheme}
    </button>
  );
}
