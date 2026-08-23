import { join } from "node:path";
import { registryItemSchema } from "shadcn/schema";
import { describe, expect, it } from "vitest";

import { createRegistryItem, isRegistryItemName, registryItemNames } from "../src";

const registryDirectory = join(import.meta.dirname, "../registry");

describe("Anvia component registry", () => {
  it("publishes the supported item names", () => {
    expect(registryItemNames).toEqual([
      "chat",
      "thread",
      "message",
      "composer",
      "attachment",
      "markdown",
      "tool-fallback",
    ]);
    expect(isRegistryItemName("chat")).toBe(true);
    expect(isRegistryItemName("unknown")).toBe(false);
  });

  it.each(registryItemNames)("creates a valid %s registry item", (name) => {
    const item = createRegistryItem(name, {
      packageVersion: "1.2.3",
      registryDirectory,
    });

    expect(registryItemSchema.safeParse(item).success).toBe(true);
    expect(item.dependencies).toContain("@anvia/react-ui@1.2.3");
    expect(item.files.every((file) => file.target.startsWith("@components/anvia/"))).toBe(true);
  });

  it("installs a complete chat composition", () => {
    const item = createRegistryItem("chat", {
      packageVersion: "1.2.3",
      registryDirectory,
    });

    expect(item.files.map((file) => file.target)).toEqual([
      "@components/anvia/attachment.tsx",
      "@components/anvia/markdown.tsx",
      "@components/anvia/tool-fallback.tsx",
      "@components/anvia/message.tsx",
      "@components/anvia/composer.tsx",
      "@components/anvia/thread.tsx",
      "@components/anvia/chat.tsx",
    ]);
    expect(item.css).toBeDefined();
  });
});
