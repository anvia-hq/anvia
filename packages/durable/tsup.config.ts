import { defineConfig } from "tsup";

// node:sqlite is prefix-only; stripping node: creates an import of a nonexistent package.
export default defineConfig({ removeNodeProtocol: false });
