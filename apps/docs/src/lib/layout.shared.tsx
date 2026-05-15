import { Link } from "@tanstack/react-router";
import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared";
import { ChevronDown } from "lucide-react";

const githubUrl = "https://github.com/anvia-hq/anvia";
const discordUrl = "https://discord.gg/6yegrFJBgp";
const resourceLinks = [
  { text: "Best Practices", url: "/docs/best-practices" },
  { text: "Frameworks", url: "/docs/frameworks" },
  { text: "Studio", url: "/docs/studio/overview" },
  { text: "Reference", url: "/docs/reference" },
  { text: "Models", url: "/docs/models" },
];
const agentLinks = [
  { text: "llms.txt", url: "/llms.txt", serverOnly: true },
  { text: "llms-full.txt", url: "/llms-full.txt", serverOnly: true },
];

function GitHubIcon() {
  return (
    <svg aria-hidden="true" fill="currentColor" viewBox="0 0 24 24">
      <path d="M12 2C6.48 2 2 6.58 2 12.25c0 4.53 2.87 8.37 6.84 9.72.5.1.68-.22.68-.49 0-.24-.01-.88-.01-1.73-2.78.62-3.37-1.37-3.37-1.37-.45-1.18-1.11-1.5-1.11-1.5-.91-.64.07-.63.07-.63 1 .07 1.53 1.06 1.53 1.06.9 1.57 2.35 1.12 2.92.86.09-.67.35-1.12.63-1.38-2.22-.26-4.55-1.14-4.55-5.07 0-1.12.39-2.03 1.03-2.75-.1-.26-.45-1.3.1-2.71 0 0 .84-.28 2.75 1.05A9.36 9.36 0 0 1 12 6.99c.85 0 1.71.12 2.51.34 1.91-1.33 2.75-1.05 2.75-1.05.55 1.41.2 2.45.1 2.71.64.72 1.03 1.63 1.03 2.75 0 3.94-2.34 4.81-4.57 5.07.36.32.68.95.68 1.92 0 1.38-.01 2.49-.01 2.83 0 .27.18.59.69.49A10.08 10.08 0 0 0 22 12.25C22 6.58 17.52 2 12 2Z" />
    </svg>
  );
}

function DiscordIcon() {
  return (
    <svg aria-hidden="true" fill="currentColor" viewBox="0 0 24 24">
      <path d="M20.32 4.37A19.8 19.8 0 0 0 15.36 2.8a13.78 13.78 0 0 0-.64 1.32 18.28 18.28 0 0 0-5.49 0 12.64 12.64 0 0 0-.65-1.32 19.74 19.74 0 0 0-4.96 1.57C.48 9.12-.37 13.75.05 18.32a19.92 19.92 0 0 0 6.08 3.06 14.6 14.6 0 0 0 1.3-2.1 12.9 12.9 0 0 1-2.04-.98c.17-.12.34-.25.5-.38a14.15 14.15 0 0 0 12.18 0c.16.13.33.26.5.38-.65.39-1.33.72-2.05.98.38.74.82 1.44 1.3 2.1a19.88 19.88 0 0 0 6.09-3.06c.5-5.3-.86-9.88-3.59-13.95ZM8.02 15.51c-1.19 0-2.16-1.1-2.16-2.45s.95-2.45 2.16-2.45c1.2 0 2.18 1.1 2.16 2.45 0 1.35-.96 2.45-2.16 2.45Zm7.96 0c-1.19 0-2.16-1.1-2.16-2.45s.95-2.45 2.16-2.45c1.2 0 2.18 1.1 2.16 2.45 0 1.35-.96 2.45-2.16 2.45Z" />
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
  links: Array<{ text: string; url: string; serverOnly?: boolean }>;
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
        {links.map((item) =>
          item.serverOnly ? (
            <a
              className="block px-3 py-2 text-sm text-zinc-400 transition hover:bg-white/[0.06] hover:text-white"
              href={item.url}
              key={item.url}
            >
              {item.text}
            </a>
          ) : (
            <Link
              className="block px-3 py-2 text-sm text-zinc-400 transition hover:bg-white/[0.06] hover:text-white"
              key={item.url}
              to={item.url}
            >
              {item.text}
            </Link>
          ),
        )}
      </div>
    </li>
  );
}

export const baseOptions: BaseLayoutProps = {
  nav: {
    title: (
      <>
        <img src="/assets/logo.png" alt="" className="h-[1.7rem] w-auto" />
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
      text: "Sponsors",
      url: "/sponsors",
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
    {
      type: "icon",
      text: "Discord",
      label: "Join Discord",
      url: discordUrl,
      external: true,
      icon: <DiscordIcon />,
      on: "nav",
    },
  ],
  themeSwitch: {
    enabled: false,
  },
};
