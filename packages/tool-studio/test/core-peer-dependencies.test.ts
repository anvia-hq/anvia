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
  it("keeps Core as a synchronized workspace peer of React", () => {
    const packageManifest = readPackageManifest("../../react/package.json");

    expect(packageManifest.dependencies?.["@anvia/core"]).toBeUndefined();
    expect(packageManifest.devDependencies?.["@anvia/core"]).toBe("workspace:*");
    expect(packageManifest.peerDependencies?.["@anvia/core"]).toBe("workspace:*");
  });

  it("keeps Client as the Server protocol peer", () => {
    const packageManifest = readPackageManifest("../../server/package.json");

    expect(packageManifest.dependencies?.["@anvia/client"]).toBeUndefined();
    expect(packageManifest.devDependencies?.["@anvia/client"]).toBe("workspace:*");
    expect(packageManifest.peerDependencies?.["@anvia/client"]).toBe("workspace:*");
    expect(packageManifest.peerDependencies?.["@anvia/core"]).toBeUndefined();
  });
});
