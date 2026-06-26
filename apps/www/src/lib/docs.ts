import type { CollectionEntry } from "astro:content";

export type DocsEntry = CollectionEntry<"docs">;
export type DocsSection = DocsEntry["data"]["section"];

export const docsSections: Array<{ id: DocsSection; label: string }> = [
  { id: "basics", label: "Basics" },
  { id: "advanced", label: "Advanced" },
  { id: "examples", label: "Examples" },
  { id: "compare", label: "Compare" },
];

const sidebarGroupOrder: Partial<Record<DocsSection, string[]>> = {
  basics: ["Runtime", "Capabilities", "App integration", "Tools and Studio"],
  advanced: [
    "Production architecture",
    "Agent runtime",
    "Tools and action safety",
    "Knowledge and retrieval",
    "Structured workflows",
    "Quality and operations",
  ],
  examples: ["Examples"],
  compare: ["Compare"],
};

export function docHref(entry: DocsEntry) {
  return `/docs/${entry.id}`;
}

export function docLabel(entry: DocsEntry) {
  return entry.data.sidebar.label ?? entry.data.title;
}

export function sectionLabel(sectionId: DocsSection) {
  return docsSections.find((section) => section.id === sectionId)?.label ?? sectionId;
}

export function isPublishedDoc(entry: DocsEntry) {
  return import.meta.env.PROD ? entry.data.draft !== true : true;
}

export function sortDocs(entries: DocsEntry[]) {
  return [...entries].sort((a, b) => {
    const sectionOrder =
      docsSections.findIndex((section) => section.id === a.data.section) -
      docsSections.findIndex((section) => section.id === b.data.section);

    if (sectionOrder !== 0) {
      return sectionOrder;
    }

    const groupOrder =
      getSidebarGroupOrder(a.data.section, a.data.sidebar.group) -
        getSidebarGroupOrder(b.data.section, b.data.sidebar.group) ||
      a.data.sidebar.group.localeCompare(b.data.sidebar.group);

    if (groupOrder !== 0) {
      return groupOrder;
    }

    return a.data.sidebar.order - b.data.sidebar.order || a.data.title.localeCompare(b.data.title);
  });
}

function getSidebarGroupOrder(section: DocsSection, group: string) {
  const order = sidebarGroupOrder[section]?.indexOf(group) ?? -1;

  return order === -1 ? Number.MAX_SAFE_INTEGER : order;
}

export function getSectionLandingHref(entries: DocsEntry[], section: DocsSection) {
  const firstEntry = sortDocs(entries).find((entry) => entry.data.section === section);

  return firstEntry ? docHref(firstEntry) : "/docs";
}

export function getSidebarGroups(entries: DocsEntry[], activeSection?: DocsSection) {
  const visibleEntries = activeSection
    ? entries.filter((entry) => entry.data.section === activeSection)
    : entries;
  const groups = new Map<string, DocsEntry[]>();

  for (const entry of sortDocs(visibleEntries)) {
    const group = entry.data.sidebar.group;
    groups.set(group, [...(groups.get(group) ?? []), entry]);
  }

  return Array.from(groups, ([title, groupEntries]) => ({ title, entries: groupEntries }));
}
