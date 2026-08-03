import { describe, expect, it } from "vitest";
import { createTextFilePage } from "../src/text-file";

describe("createTextFilePage", () => {
  it("returns a line page with continuation metadata", () => {
    expect(
      createTextFilePage("one\ntwo\nthree\nfour\n", {
        startLine: 2,
        lineCount: 2,
        maxBytes: 1_024,
      }),
    ).toEqual({
      content: "two\nthree\n",
      startLine: 2,
      endLine: 3,
      nextStartLine: 4,
      truncated: true,
      truncatedBy: "lines",
    });
  });

  it("returns an empty page when startLine is past the end", () => {
    expect(
      createTextFilePage("one\ntwo\n", {
        startLine: 10,
        lineCount: 2,
        maxBytes: 1_024,
      }),
    ).toEqual({
      content: "",
      startLine: 10,
      endLine: null,
      nextStartLine: null,
      truncated: false,
      truncatedBy: null,
    });
  });

  it("truncates oversized pages at a complete UTF-8 boundary", () => {
    expect(
      createTextFilePage("abc😀def\nnext\n", {
        startLine: 1,
        lineCount: 2,
        maxBytes: 6,
      }),
    ).toEqual({
      content: "abc",
      startLine: 1,
      endLine: 1,
      nextStartLine: null,
      truncated: true,
      truncatedBy: "bytes",
    });
  });

  it("provides continuation when byte truncation ends on a line boundary", () => {
    expect(
      createTextFilePage("one\ntwo\nthree\n", {
        startLine: 1,
        lineCount: 3,
        maxBytes: 4,
      }),
    ).toEqual({
      content: "one\n",
      startLine: 1,
      endLine: 1,
      nextStartLine: 2,
      truncated: true,
      truncatedBy: "bytes",
    });
  });
});
