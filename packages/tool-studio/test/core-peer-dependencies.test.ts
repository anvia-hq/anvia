import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

type PackageManifest = {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
};

function readPackageManifest(relativePath: string): PackageManifest {
  return JSON.parse(
    readFileSync(new URL(relativePath, import.meta.url), "utf8"),
  ) as PackageManifest;
}

describe("Studio Core peer dependency boundaries", () => {
  it.each([
    "../../react/package.json",
    "../../server/package.json",
  ])("keeps Core as a peer of %s", (relativePath) => {
    const packageManifest = readPackageManifest(relativePath);

    expect(packageManifest.dependencies?.["@anvia/core"]).toBeUndefined();
    expect(packageManifest.devDependencies?.["@anvia/core"]).toBe("workspace:*");
    expect(packageManifest.peerDependencies?.["@anvia/core"]).toBe(">=0.25.0 <1.0.0");
  });
});
