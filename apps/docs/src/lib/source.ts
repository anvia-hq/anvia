import { docs } from "collections/server";
import { loader } from "fumadocs-core/source";
import { lucideIconsPlugin } from "fumadocs-core/source/plugins/lucide-icons";

export const source = loader({
  baseUrl: "/docs",
  plugins: [lucideIconsPlugin()],
  source: docs.toFumadocsSource(),
});
