import { join } from "node:path";
import { registryItemSchema } from "shadcn/schema";
import { describe, expect, it } from "vitest";

import { createRegistryItem, registryItemNames } from "../src";

const registryDirectory = join(import.meta.dirname, "../registry");

describe("Anvia component registry", () => {
  it.each(registryItemNames)("creates a valid %s registry item", (name) => {
    const item = createRegistryItem(name, {
      packageVersion: "1.2.3",
      registryDirectory,
    });

    expect(registryItemSchema.safeParse(item).success).toBe(true);
    expect(item.dependencies).toContain("@anvia/react@1.2.3");
    expect(item.files.every((file) => file.target.startsWith("@components/anvia/"))).toBe(true);
  });
});
