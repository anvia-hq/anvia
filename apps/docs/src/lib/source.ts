import { docs } from "collections/server";
import { type LoaderPlugin, loader } from "fumadocs-core/source";
import { lucideIconsPlugin } from "fumadocs-core/source/plugins/lucide-icons";
import { createElement, Fragment } from "react";

const recentMenuWindowMs = 30 * 24 * 60 * 60 * 1000;

function isRecentDate(value: unknown) {
  if (typeof value !== "string") return false;

  const time = Date.parse(value);
  if (!Number.isFinite(time)) return false;

  const ageMs = Date.now() - time;
  return ageMs >= 0 && ageMs < recentMenuWindowMs;
}

function menuBadgeForMeta(data: Record<string, unknown>) {
  if (isRecentDate(data.createdAt)) return "New";
  if (isRecentDate(data.updatedAt)) return "Updated";
  return undefined;
}

function newMenuBadgePlugin(): LoaderPlugin {
  return {
    name: "anvia:new-menu-badges",
    transformPageTree: {
      folder(node, _folderPath, metaPath) {
        if (!metaPath) return node;

        const meta = this.storage.read(metaPath);
        const badge =
          meta?.format === "meta"
            ? menuBadgeForMeta(meta.data as Record<string, unknown>)
            : undefined;

        if (!badge) return node;

        return {
          ...node,
          name: createElement(Fragment, null, [
            node.name,
            createElement(
              "span",
              { className: "docs-sidebar-status-badge", key: "status-badge" },
              badge,
            ),
          ]),
        };
      },
    },
  };
}

export const source = loader({
  baseUrl: "/docs",
  plugins: [lucideIconsPlugin(), newMenuBadgePlugin()],
  source: docs.toFumadocsSource(),
});
