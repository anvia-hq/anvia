import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

// Writes reviewable snippets only; never edits an installed editor's settings.
if (process.argv.length !== 3)
  throw new Error("Usage: node examples/write-editor-configs.mjs <new-directory>");
const target = resolve(process.argv[2]);
const root = fileURLToPath(new URL("..", import.meta.url));
const command = process.execPath;
const args = [join(root, "dist/cli.js"), join(root, "examples/editor-smoke-agent.mjs")];
const mcpArgs = [join(root, "examples/editor-smoke-mcp.mjs")];
const agent = { command, args, env: {} };
await mkdir(target); // Refuse to overwrite any existing directory.
await writeFile(
  join(target, "zed.json"),
  JSON.stringify(
    {
      agent_servers: { "Anvia smoke": { type: "custom", ...agent } },
      context_servers: { "anvia-smoke": { command, args: mcpArgs, env: {} } },
    },
    null,
    2,
  ) + "\n",
);
await writeFile(
  join(target, "jetbrains-acp.json"),
  JSON.stringify(
    {
      default_mcp_settings: { use_custom_mcp: true, use_idea_mcp: false },
      agent_servers: { "Anvia smoke": agent },
    },
    null,
    2,
  ) + "\n",
);
await writeFile(
  join(target, "jetbrains-mcp.json"),
  JSON.stringify(
    {
      mcpServers: { "anvia-smoke": { command, args: mcpArgs, env: {} } },
    },
    null,
    2,
  ) + "\n",
);
// Lua long strings preserve paths with spaces/backslashes without shell interpretation.
function lua(value) {
  let equals = "";
  while (value.includes(`]${equals}]`)) equals += "=";
  return `[${equals}[${value}]${equals}]`;
}
const template = await readFile(new URL("./editor-codecompanion.lua", import.meta.url), "utf8");
const replacements = {
  "@NODE@": lua(command),
  "@CLI@": lua(args[0]),
  "@AGENT@": lua(args[1]),
  "@MCP@": lua(mcpArgs[0]),
};
await writeFile(
  join(target, "codecompanion.lua"),
  template.replace(/"(@[A-Z]+@)"/g, (_, key) => replacements[key]),
);
console.log(
  `Wrote editor smoke snippets to ${target}. See test/EDITOR_COMPATIBILITY.md before use.`,
);
