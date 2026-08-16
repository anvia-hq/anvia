import { afterEach, describe, expect, it, vi } from "vitest";
import { LensClient, LensDatasetError } from "../src/index";

let lens: LensClient | undefined;

afterEach(async () => {
  vi.unstubAllGlobals();
  await lens?.close();
  lens = undefined;
});

describe("Lens dataset client", () => {
  it("fetches every page with tracing credentials and a selected version", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        response({
          name: "support/cases",
          version: "v2",
          description: "Regression cases",
          items: [{ id: "a", input: { question: "Hi" }, expected: "Hello" }],
          meta: { page: 1, limit: 1, totalItems: 2, totalPages: 2 },
        }),
      )
      .mockResolvedValueOnce(
        response({
          name: "support/cases",
          version: "v2",
          description: "Regression cases",
          items: [{ id: "b", input: "Bye", context: ["policy"] }],
          meta: { page: 2, limit: 1, totalItems: 2, totalPages: 2 },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);
    lens = createClient();
    const dataset = await lens
      .datasetClient({ pageSize: 1 })
      .getDataset({ name: "support/cases", version: "v2" });

    expect(dataset).toEqual({
      name: "support/cases",
      version: "v2",
      description: "Regression cases",
      items: [
        { id: "a", input: { question: "Hi" }, expected: "Hello" },
        { id: "b", input: "Bye", context: ["policy"] },
      ],
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [firstUrl, firstInit] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(firstUrl.toString()).toBe(
      "https://lens.example/api/public/datasets/support%2Fcases?page=1&limit=1&version=v2",
    );
    expect(firstInit.headers).toEqual(
      expect.objectContaining({
        Authorization: `Basic ${Buffer.from("pk:sk").toString("base64")}`,
      }),
    );
  });

  it("surfaces typed API and invalid-response errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(response({ error: { code: "not_found", message: "Missing" } }, 404))
        .mockResolvedValueOnce(response({ name: "bad", items: [], meta: { totalPages: 1 } })),
    );
    lens = createClient();
    const client = lens.datasetClient();

    await expect(client.getDataset({ name: "missing" })).rejects.toMatchObject({
      name: "LensDatasetError",
      status: 404,
      code: "not_found",
      message: "Missing",
    });
    const invalid = client.getDataset({ name: "bad" });
    await expect(invalid).rejects.toBeInstanceOf(LensDatasetError);
    await expect(invalid).rejects.toMatchObject({ code: "invalid_response" });
  });

  it("rejects inconsistent pagination instead of combining unstable pages", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          response({
            name: "changing",
            version: "v1",
            items: [{ id: "a", input: "first" }],
            meta: { page: 1, limit: 1, totalItems: 2, totalPages: 2 },
          }),
        )
        .mockResolvedValueOnce(
          response({
            name: "changing",
            version: "v1",
            items: [{ id: "b", input: "second" }],
            meta: { page: 2, limit: 1, totalItems: 3, totalPages: 3 },
          }),
        ),
    );
    lens = createClient();

    await expect(
      lens.datasetClient({ pageSize: 1 }).getDataset({ name: "changing" }),
    ).rejects.toMatchObject({
      code: "invalid_response",
      message: "Lens returned inconsistent dataset pagination",
    });
  });

  it("rejects datasets that exceed the pagination safety limit", async () => {
    const fetchMock = vi.fn().mockImplementation(() =>
      Promise.resolve(
        response({
          name: "too-large",
          version: "v1",
          items: [{ id: "case", input: "value" }],
          meta: { page: 1, limit: 1, totalItems: 101, totalPages: 101 },
        }),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    lens = createClient();

    await expect(
      lens.datasetClient({ pageSize: 1 }).getDataset({ name: "too-large" }),
    ).rejects.toMatchObject({
      code: "pagination_limit",
      message: "Lens dataset exceeds the pagination limit",
    });
    expect(fetchMock).toHaveBeenCalledTimes(100);
  });

  it("validates client options", async () => {
    lens = createClient();
    expect(() => lens?.datasetClient({ pageSize: 0 })).toThrow(
      "pageSize must be an integer between 1 and 100",
    );
  });
});

function createClient(): LensClient {
  return new LensClient({
    baseUrl: "https://lens.example",
    publicKey: "pk",
    secretKey: "sk",
    serviceName: "dataset-test",
  });
}

function response(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
