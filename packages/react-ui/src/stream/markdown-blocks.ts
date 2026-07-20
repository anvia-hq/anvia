import { lexer } from "marked";

export type StreamMarkdownBlock = {
  content: string;
  startOffset: number;
};

export function splitStreamMarkdownBlocks(
  content: string,
  options: { singleDocument?: boolean } = {},
): StreamMarkdownBlock[] {
  if (content.length === 0) {
    return [];
  }
  if (options.singleDocument === true) {
    return [{ content, startOffset: 0 }];
  }

  try {
    const tokens = lexer(content, { gfm: false });
    if (tokens.some((token) => token.type === "def") || Object.keys(tokens.links).length > 0) {
      return [{ content, startOffset: 0 }];
    }

    const rawBlocks: string[] = [];
    for (const token of tokens) {
      if (token.type === "space" && rawBlocks.length > 0) {
        const lastIndex = rawBlocks.length - 1;
        rawBlocks[lastIndex] = `${rawBlocks[lastIndex] ?? ""}${token.raw}`;
      } else {
        rawBlocks.push(token.raw);
      }
    }

    if (rawBlocks.length === 0 || rawBlocks.join("") !== content) {
      return [{ content, startOffset: 0 }];
    }

    let startOffset = 0;
    return rawBlocks.map((block) => {
      const result = { content: block, startOffset };
      startOffset += block.length;
      return result;
    });
  } catch {
    return [{ content, startOffset: 0 }];
  }
}
