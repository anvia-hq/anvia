import { describe, expect, it } from "vitest";
import { formatDocument, Message, normalizeDocuments } from "../src/index";

describe("completion document normalization", () => {
  it("returns no message for empty documents", () => {
    expect(normalizeDocuments([])).toBeUndefined();
  });

  it("normalizes documents into one tagged user message", () => {
    expect(
      normalizeDocuments([
        { id: "facts", text: "Anvia uses TypeScript." },
        { id: "owner", text: "Mira owns launch checklists." },
      ]),
    ).toEqual(
      Message.user(
        [
          "<file id: facts>\nAnvia uses TypeScript.\n</file>\n",
          "<file id: owner>\nMira owns launch checklists.\n</file>\n",
        ].join("\n"),
      ),
    );
  });

  it("formats document metadata in stable sorted order", () => {
    expect(
      formatDocument({
        id: "release",
        text: "Launch is Friday.",
        additionalProps: {
          zeta: "last",
          alpha: "first",
        },
      }),
    ).toBe(
      '<file id: release>\n<metadata alpha: "first" zeta: "last" />\nLaunch is Friday.\n</file>\n',
    );
  });
});
