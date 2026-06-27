import { getCollection } from "astro:content";
import { docHref, docLabel, isPublishedDoc, sectionLabel, sortDocs } from "./docs";

const defaultSite = "https://anvia.dev";

interface LlmsOptions {
  site?: URL;
}

export async function buildLlmsIndex(options: LlmsOptions = {}) {
  const docs = (await getPublishedDocs()).filter((entry) => entry.data.section === "basics");
  const baseUrl = siteUrl(options.site);
  const lines = [
    "# Anvia",
    "",
    "> TypeScript runtime for building provider-agnostic AI agents, tools, retrieval, pipelines, and observability inside application code.",
    "",
    "Use these Basics docs links when you need Anvia documentation optimized for coding agents and LLM context windows.",
  ];

  if (docs.length > 0) {
    lines.push("", `## ${sectionLabel("basics")}`, "");
  }

  for (const entry of docs) {
    lines.push(
      `- [${docLabel(entry)}](${absoluteUrl(docHref(entry), baseUrl)}): ${entry.data.description}`,
    );
  }

  return `${lines.join("\n")}\n`;
}

export async function buildLlmsFull(options: LlmsOptions = {}) {
  const docs = await getPublishedDocs();
  const baseUrl = siteUrl(options.site);
  const lines = [
    "# Anvia Full Documentation",
    "",
    "Complete Markdown export of every published Anvia docs page.",
    "",
    `Source index: ${absoluteUrl("/llms.txt", baseUrl)}`,
  ];

  for (const entry of docs) {
    const body = normalizeMarkdown(entry.body ?? "", baseUrl).trim();

    lines.push(
      "",
      "---",
      "",
      `# ${entry.data.title}`,
      "",
      `URL: ${absoluteUrl(docHref(entry), baseUrl)}`,
      `Section: ${sectionLabel(entry.data.section)}`,
      `Group: ${entry.data.sidebar.group}`,
      `Description: ${entry.data.description}`,
      "",
    );

    if (body.length > 0) {
      lines.push(body, "");
    }
  }

  return `${lines.join("\n")}\n`;
}

async function getPublishedDocs() {
  return sortDocs((await getCollection("docs")).filter(isPublishedDoc));
}

function siteUrl(site?: URL) {
  return (site ?? new URL(defaultSite)).toString().replace(/\/$/, "");
}

function absoluteUrl(path: string, baseUrl: string) {
  return new URL(path, `${baseUrl}/`).toString();
}

function normalizeMarkdown(markdown: string, baseUrl: string) {
  return stripFrontmatter(markdown)
    .replace(/\]\((\/[^)\s#]+(?:#[^)\s]+)?)\)/g, (_match, path: string) => {
      return `](${absoluteUrl(path, baseUrl)})`;
    })
    .replace(/]\((\/#[^)\s]+)\)/g, (_match, path: string) => {
      return `](${absoluteUrl(path, baseUrl)})`;
    })
    .trimEnd();
}

function stripFrontmatter(markdown: string) {
  return markdown.replace(/^---\n[\s\S]*?\n---\n?/, "");
}
