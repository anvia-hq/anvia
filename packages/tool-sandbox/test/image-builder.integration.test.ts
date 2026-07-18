import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runCli } from "../src/cli";
import { runDockerCli } from "../src/docker-cli";
import { DockerSandbox } from "../src/docker-sandbox";

const runDockerTests = process.env.ANVIA_SANDBOX_DOCKER_TESTS === "1";

describe.skipIf(!runDockerTests)("sandbox image builder integration", () => {
  it("builds and runs the complete runtime and artifact toolchain", async () => {
    const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "anvia-sandbox-image-"));
    const imageTag = `anvia-sandbox-integration:${Date.now()}`;
    let session: Awaited<ReturnType<DockerSandbox["createSession"]>> | undefined;

    try {
      const exitCode = await runCli(
        [
          "create-image",
          "--name",
          "integration",
          "--runtime",
          "bun",
          "--feature",
          "artifacts",
          "--feature",
          "playwright",
          "--tag",
          imageTag,
          "--output",
          path.join(temporaryDirectory, "context"),
        ],
        temporaryDirectory,
        {
          log: () => {},
          warn: () => {},
          error: () => {},
          stdout: () => {},
          stderr: () => {},
        },
        { isTTY: false, packageVersion: "integration" },
      );
      expect(exitCode).toBe(0);

      const sandbox = new DockerSandbox({
        image: imageTag,
        pull: "never",
        network: false,
        limits: { timeoutMs: 120_000, maxOutputBytes: 256_000 },
      });
      session = await sandbox.createSession({
        id: `image-builder-${Date.now()}`,
        manifest: {
          files: {
            "artifacts.py": pythonArtifactScript,
            "browser.mjs": playwrightScript,
          },
        },
      });

      const versions = await session.exec({
        command: "sh",
        args: [
          "-lc",
          "node --version && pnpm --version && bun --version && python --version && uv --version",
        ],
      });
      expect(versions.exitCode, versions.stderr).toBe(0);
      expect(versions.stdout).toContain("v24.18.0");
      expect(versions.stdout).toContain("11.0.4");
      expect(versions.stdout).toContain("1.3.14");
      expect(versions.stdout).toContain("Python 3.13.14");

      const artifacts = await session.exec({ command: "python", args: ["artifacts.py"] });
      expect(artifacts.exitCode, artifacts.stderr).toBe(0);
      const browser = await session.exec({ command: "node", args: ["browser.mjs"] });
      expect(browser.exitCode, browser.stderr).toBe(0);

      const files = await session.listFiles("output");
      expect(files.map((file) => file.path).sort()).toEqual([
        "output/chart.png",
        "output/report.pdf",
        "output/screenshot.png",
        "output/workbook.xlsx",
      ]);
    } finally {
      await session?.destroy();
      await runDockerCli(["image", "rm", imageTag], { dockerPath: "docker" });
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  }, 600_000);
});

const pythonArtifactScript = `
from pathlib import Path
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import pandas as pd
import seaborn as sns
from PIL import Image
from docx import Document
from openpyxl import Workbook
from pypdf import PdfReader
from reportlab.pdfgen import canvas
import xlsxwriter

output = Path("output")
output.mkdir(exist_ok=True)
sns.set_theme()
plt.plot([1, 2, 3], [1, 4, 9])
plt.savefig(output / "chart.png")
pdf = canvas.Canvas(str(output / "report.pdf"))
pdf.drawString(72, 720, "Anvia sandbox report")
pdf.showPage()
pdf.save()
Workbook().save(output / "workbook.xlsx")
assert Image.open(output / "chart.png").size[0] > 0
assert len(PdfReader(output / "report.pdf").pages) == 1
assert pd.DataFrame({"value": [1]}).iloc[0, 0] == 1
assert Document() is not None
assert xlsxwriter.__version__
`;

const playwrightScript = `
import { chromium } from "playwright";
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 640, height: 480 } });
await page.setContent("<main><h1>Anvia sandbox</h1></main>");
await page.screenshot({ path: "output/screenshot.png" });
await browser.close();
`;
