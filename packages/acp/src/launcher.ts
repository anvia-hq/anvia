import { Agent } from "@anvia/core/agent";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { AcpSessionFactory } from "./types.js";

/** Load a trusted local ESM module. Factory evaluation belongs to session/new, not startup. */
export async function loadSessionFactory(modulePath: string): Promise<AcpSessionFactory> {
  const module: Record<string, unknown> = await import(pathToFileURL(resolve(modulePath)).href);
  if (typeof module.sessionFactory === "function") {
    return module.sessionFactory as AcpSessionFactory;
  }
  if (typeof module.default === "function") {
    return module.default as AcpSessionFactory;
  }
  const agent = module.default ?? module.agent;
  if (!(agent instanceof Agent)) {
    throw new TypeError("Expected an Anvia Agent or sessionFactory export.");
  }

  // A singleton must never share mutable agent state across sessions.
  let claimed = false;
  return () => {
    if (claimed) {
      throw new Error("An exported Agent supports one session; export a sessionFactory instead.");
    }
    claimed = true;
    return { agent };
  };
}
