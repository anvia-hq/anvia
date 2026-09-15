import { afterEach, expect, it, vi } from "vitest";
import { PineconeVectorClient } from "../src/index.js";

afterEach(() => vi.unstubAllGlobals());

it("provisions and uses a vector index through the real SDK with mocked HTTP", async () => {
  const index = {
    name: "sdk-compat",
    host: "sdk-compat.svc.pinecone.io",
    schema: {
      fields: { _values: { type: "dense_vector", dimension: 2, metric: "cosine" } },
    },
    deployment: { deployment_type: "managed", cloud: "aws", region: "us-east-1" },
    status: { ready: true, state: "Ready" },
  };
  let created = false;
  const requests: Array<{ path: string; body: unknown }> = [];
  const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
    const request = new Request(input, init);
    const path = new URL(request.url).pathname;
    const body = request.method === "POST" ? await request.json() : {};
    requests.push({ path, body });
    if (path === "/indexes" && request.method === "GET") {
      return Response.json({ indexes: created ? [index] : [] });
    }
    if (path === "/indexes" && request.method === "POST") {
      created = true;
      return Response.json(index, { status: 201 });
    }
    if (path === "/indexes/sdk-compat") return Response.json(index);
    if (path === "/vectors/delete") return Response.json({});
    if (path === "/vectors/upsert") return Response.json({ upsertedCount: 1 });
    if (path === "/query") {
      return Response.json({
        matches: [
          {
            id: "point",
            score: 0.9,
            metadata: { __anvia_document_id: "doc", __anvia_document: JSON.stringify("cat") },
          },
        ],
      });
    }
    throw new Error(`Unexpected SDK request: ${request.method} ${path}`);
  });
  vi.stubGlobal("fetch", fetch);

  const client = new PineconeVectorClient({ apiKey: "test-key" });
  const store = client.vectorStore<string>({
    indexName: index.name,
    namespace: "docs",
    dimensions: 2,
    spec: { serverless: { cloud: "aws", region: "us-east-1" } },
  });
  await store.ensure();
  expect(requests).toContainEqual({
    path: "/indexes",
    body: expect.objectContaining({ name: index.name, schema: index.schema }),
  });
  await store.upsert({
    documents: [{ id: "doc", document: "cat", embeddings: [{ document: "cat", vector: [1, 0] }] }],
  });
  expect(requests).toContainEqual({
    path: "/vectors/upsert",
    body: expect.objectContaining({
      namespace: "docs",
      vectors: [expect.objectContaining({ values: [1, 0] })],
    }),
  });
  await expect(store.search({ vector: [1, 0], topK: 1 })).resolves.toEqual([
    { id: "doc", document: "cat", score: 0.9 },
  ]);
  await client.close();
});
