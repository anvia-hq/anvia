import { Link } from "@tanstack/react-router";
import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared";
import { ChevronDown } from "lucide-react";

const githubUrl = "https://github.com/anvia-hq/anvia";
const resourceLinks = [
  { text: "Docs", url: "/docs/guides" },
  { text: "Frameworks", url: "/docs/frameworks" },
  { text: "Studio", url: "/docs/studio/overview" },
  { text: "Reference", url: "/docs/reference" },
  { text: "Models", url: "/docs/models" },
];
const agentLinks = [
  { text: "llms.txt", url: "/llms.txt" },
  { text: "llms-full.txt", url: "/llms-full.txt" },
];

function GitHubIcon() {
  return (
    <svg aria-hidden="true" fill="currentColor" viewBox="0 0 24 24">
      <path d="M12 2C6.48 2 2 6.58 2 12.25c0 4.53 2.87 8.37 6.84 9.72.5.1.68-.22.68-.49 0-.24-.01-.88-.01-1.73-2.78.62-3.37-1.37-3.37-1.37-.45-1.18-1.11-1.5-1.11-1.5-.91-.64.07-.63.07-.63 1 .07 1.53 1.06 1.53 1.06.9 1.57 2.35 1.12 2.92.86.09-.67.35-1.12.63-1.38-2.22-.26-4.55-1.14-4.55-5.07 0-1.12.39-2.03 1.03-2.75-.1-.26-.45-1.3.1-2.71 0 0 .84-.28 2.75 1.05A9.36 9.36 0 0 1 12 6.99c.85 0 1.71.12 2.51.34 1.91-1.33 2.75-1.05 2.75-1.05.55 1.41.2 2.45.1 2.71.64.72 1.03 1.63 1.03 2.75 0 3.94-2.34 4.81-4.57 5.07.36.32.68.95.68 1.92 0 1.38-.01 2.49-.01 2.83 0 .27.18.59.69.49A10.08 10.08 0 0 0 22 12.25C22 6.58 17.52 2 12 2Z" />
    </svg>
  );
}

function ResourcesDropdown() {
  return <NavDropdown label="Resources" links={resourceLinks} />;
}

function AgentsDropdown() {
  return <NavDropdown label="For agents" links={agentLinks} />;
}

function NavDropdown({
  label,
  links,
}: {
  label: string;
  links: Array<{ text: string; url: string }>;
}) {
  return (
    <li className="group relative list-none">
      <button
        className="inline-flex items-center gap-1 p-2 text-sm text-fd-muted-foreground transition-colors hover:text-fd-accent-foreground"
        type="button"
      >
        {label}
        <ChevronDown className="size-3.5 transition-transform group-hover:rotate-180 group-focus-within:rotate-180" />
      </button>
      <div className="invisible absolute left-0 top-full z-50 min-w-44 border border-white/10 bg-[#050505] p-1 opacity-0 shadow-xl shadow-black/30 transition group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100">
        {links.map((item) => (
          <Link
            className="block px-3 py-2 text-sm text-zinc-400 transition hover:bg-white/[0.06] hover:text-white"
            key={item.url}
            to={item.url}
          >
            {item.text}
          </Link>
        ))}
      </div>
    </li>
  );
}

export const baseOptions: BaseLayoutProps = {
  nav: {
    title: (
      <>
        <img src="/assets/logo.png" alt="" className="h-8 w-auto" />
        <span className="anvia-wordmark">Anvia</span>
      </>
    ),
  },
  links: [
    {
      text: "Docs",
      url: "/docs",
      active: "nested-url",
      on: "nav",
    },
    {
      type: "custom",
      children: <ResourcesDropdown />,
      on: "nav",
    },
    {
      type: "custom",
      children: <AgentsDropdown />,
      on: "nav",
    },
    {
      text: "Blog",
      url: "/blog",
      active: "nested-url",
      on: "nav",
    },
    {
      type: "icon",
      text: "GitHub",
      label: "GitHub",
      url: githubUrl,
      external: true,
      icon: <GitHubIcon />,
      on: "nav",
    },
  ],
  themeSwitch: {
    enabled: false,
  },
};
