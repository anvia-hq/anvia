import { createSandboxTools, DockerSandbox } from "@anvia/sandbox";

const sandbox = new DockerSandbox({
  image: "node:22-bookworm",
  pull: "missing",
  limits: {
    timeoutMs: 30_000,
    maxOutputBytes: 64_000,
  },
});

const session = await sandbox.createSession({
  manifest: {
    files: {
      "index.js": [
        "const input = Number(process.argv[2]);",
        "console.log(JSON.stringify({ input, doubled: input * 2 }));",
      ].join("\n"),
    },
  },
});

try {
  const tools = createSandboxTools(session);
  const callTool = (name: string, args: unknown) => {
    const tool = tools.find((candidate) => candidate.name === name);
    if (tool === undefined) throw new Error(`Missing sandbox tool: ${name}`);
    return tool.call(args);
  };

  console.log(
    await callTool("exec_command", {
      command: "node",
      args: ["index.js", "21"],
    }),
  );

  await callTool("write_file", {
    path: "notes/result.txt",
    content: "The sandbox wrote this file.",
  });

  console.log(await callTool("read_file", { path: "notes/result.txt" }));
  console.log(await callTool("list_files", { path: "notes" }));
} finally {
  await session.destroy();
}
