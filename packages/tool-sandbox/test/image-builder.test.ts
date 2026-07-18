import { describe, expect, it } from "vitest";
import {
  artifactPythonPackages,
  renderSandboxImageContext,
  resolveSandboxImageSpec,
  unpinnedSandboxImagePackages,
} from "../src/image-builder";

describe("sandbox image builder", () => {
  it("normalizes composable features and their runtime dependencies", () => {
    const spec = resolveSandboxImageSpec({
      name: "creative-suite",
      runtimes: ["bun"],
      features: ["playwright", "artifacts"],
      packages: {
        apt: ["imagemagick=8:7.1.1.43+dfsg1-1"],
        npm: ["sharp@0.34.4"],
        uv: ["scipy==1.17.0"],
      },
    });

    expect(spec.runtimes).toEqual(["node", "bun", "python"]);
    expect(spec.features).toEqual(["artifacts", "playwright"]);
    expect(spec.tag).toBe("anvia-sandbox-creative-suite:latest");
  });

  it("renders a combined context with pinned dependencies", () => {
    const spec = resolveSandboxImageSpec({
      name: "reports",
      features: ["artifacts", "playwright"],
    });
    const context = renderSandboxImageContext(spec, "0.5.0");
    const dockerfile = context.files.get("Dockerfile");
    const pythonProject = context.files.get("pyproject.toml");
    const packageJson = JSON.parse(context.files.get("package.json") ?? "{}") as {
      dependencies?: Record<string, string>;
    };

    expect(dockerfile).toContain("FROM node:24.18.0-bookworm-slim AS node-runtime");
    expect(dockerfile).toContain("FROM python:3.13.14-slim-bookworm AS python-runtime");
    expect(dockerfile).toContain("mcr.microsoft.com/playwright:v1.61.0-noble");
    expect(dockerfile).toContain("COPY --from=uv-runtime /uv /uvx /usr/local/bin/");
    expect(dockerfile).toContain("uv sync --no-dev --no-cache --no-install-project");
    expect(dockerfile).toContain("ENV VIRTUAL_ENV=/opt/anvia-python/.venv");
    expect(dockerfile).toContain("ENV PATH=/opt/anvia-python/.venv/bin:$PATH");
    expect(dockerfile).toContain("WORKDIR /workspace");
    expect(dockerfile).toContain("ENTRYPOINT []");
    for (const requirement of artifactPythonPackages) {
      expect(pythonProject).toContain(JSON.stringify(requirement));
    }
    expect(packageJson.dependencies).toEqual({ playwright: "1.61.0" });
    expect(context.manifest).toMatchObject({
      schemaVersion: 1,
      generatedBy: { package: "@anvia/sandbox", version: "0.5.0" },
      runtimes: ["node", "python"],
    });
    expect(context.manifest.generatedFiles).toEqual([
      ".dockerignore",
      "Dockerfile",
      "anvia-sandbox.json",
      "package.json",
      "pyproject.toml",
    ]);
  });

  it("uses Bun to install npm-registry packages when Node is absent", () => {
    const spec = resolveSandboxImageSpec({
      name: "bun-tools",
      runtimes: ["bun"],
      packages: { npm: ["prettier@3.8.2"] },
    });
    const context = renderSandboxImageContext(spec, "0.5.0");

    expect(spec.runtimes).toEqual(["bun"]);
    expect(context.files.get("Dockerfile")).toContain("cd /opt/anvia-js");
    expect(context.files.get("Dockerfile")).toContain("bun install --production --no-save");
    expect(context.files.get("Dockerfile")).toContain(
      "ENV PATH=/opt/anvia-js/node_modules/.bin:$PATH",
    );
    expect(context.files.get("Dockerfile")).not.toContain("FROM node:");
  });

  it("adds a runtime for runtime-specific custom packages", () => {
    expect(
      resolveSandboxImageSpec({ name: "python-extra", packages: { uv: ["rich==14.3.3"] } })
        .runtimes,
    ).toEqual(["python"]);
    expect(
      resolveSandboxImageSpec({ name: "node-extra", packages: { npm: ["tsx@4.21.0"] } }).runtimes,
    ).toEqual(["node"]);
  });

  it("rejects unsafe or ambiguous inputs", () => {
    expect(() => resolveSandboxImageSpec({ name: "Invalid", runtimes: ["node"] })).toThrow(
      "Image name",
    );
    expect(() =>
      resolveSandboxImageSpec({
        name: "bad-apt",
        runtimes: ["node"],
        packages: { apt: ["git curl"] },
      }),
    ).toThrow("Invalid apt package");
    expect(() =>
      resolveSandboxImageSpec({
        name: "bad-npm",
        runtimes: ["node"],
        packages: { npm: ["package@1.0.0;rm"] },
      }),
    ).toThrow("Invalid npm package version");
    expect(() => resolveSandboxImageSpec({ name: "empty", runtimes: [], features: [] })).toThrow(
      "Select at least one",
    );
  });

  it("reports custom packages whose versions can drift", () => {
    const spec = resolveSandboxImageSpec({
      name: "unpinned",
      runtimes: ["node"],
      packages: {
        apt: ["git", "curl=8.0"],
        npm: ["prettier", "tsx@4.21.0"],
        uv: ["rich", "pydantic==2.12.5"],
      },
    });

    expect(unpinnedSandboxImagePackages(spec)).toEqual(["prettier", "rich"]);
  });
});
