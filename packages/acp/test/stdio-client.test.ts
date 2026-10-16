import { expect, it } from "vitest";
import { stdioClient } from "./stdio-client.js";

it.each([
  "accidental stdout log\n",
  '{"validJsonButNotRpc":true}\n',
  '{"jsonrpc":"2.0","id":1,"error":null}\n',
  '{"jsonrpc":"2.0","method":"callback","params":"invalid"}\n',
  '{"jsonrpc":"2.0","id":1,"result":{},"error":{"code":1,"message":"both"}}\n',
  '{"jsonrpc":"2.0","id":1,"result":{}}',
])("the fixture client rejects contaminated or malformed stdout: %s", async (stdout) => {
  const peer = stdioClient("-e", [`process.stdout.write(${JSON.stringify(stdout)})`]);
  await expect(peer.close()).rejects.toBeDefined();
});

it("the fixture client rejects duplicate responses even after a request appears successful", async () => {
  const peer = stdioClient("-e", [
    `process.stdin.once("data", (chunk) => {
      const { id } = JSON.parse(chunk);
      const line = JSON.stringify({ jsonrpc: "2.0", id, result: {} }) + "\\n";
      process.stdout.write(line + line);
      process.stdin.resume();
    });`,
  ]);
  try {
    expect(await peer.request("initialize", { protocolVersion: 1 })).toMatchObject({ result: {} });
  } finally {
    await expect(peer.close()).rejects.toThrow("settlement");
  }
});
