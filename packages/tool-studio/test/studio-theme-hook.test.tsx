// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useStudioTheme } from "../src/ui/app/app-theme";

describe("useStudioTheme", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("localStorage", createMemoryStorage());
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("toggles with the button and D shortcut outside editable controls", () => {
    act(() => root.render(<ThemeHarness />));
    expect(container.textContent).toContain("dark/dark");

    act(() => container.querySelector("button")?.click());
    expect(container.textContent).toContain("light/light");

    act(() => {
      container
        .querySelector("input")
        ?.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "d" }));
    });
    expect(container.textContent).toContain("light/light");

    act(() => {
      container
        .querySelector("[contenteditable]")
        ?.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "D" }));
    });
    expect(container.textContent).toContain("light/light");

    act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "D", shiftKey: true })));
    expect(container.textContent).toContain("dark/dark");
  });
});

function createMemoryStorage(): Storage {
  const entries = new Map<string, string>();

  return {
    clear: () => entries.clear(),
    getItem: (key) => entries.get(key) ?? null,
    key: (index) => [...entries.keys()][index] ?? null,
    get length() {
      return entries.size;
    },
    removeItem: (key) => {
      entries.delete(key);
    },
    setItem: (key, value) => {
      entries.set(key, value);
    },
  };
}

function ThemeHarness() {
  const { resolvedTheme, theme, toggleTheme } = useStudioTheme();
  return (
    <>
      <button type="button" onClick={toggleTheme}>
        {theme}/{resolvedTheme}
      </button>
      <input aria-label="Editable field" />
      <div aria-label="Editable region" contentEditable />
    </>
  );
}
