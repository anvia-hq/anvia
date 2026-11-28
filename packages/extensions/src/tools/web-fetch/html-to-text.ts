const ENTITY_MAP: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

function stripNonContentBlocks(html: string): string {
  return html
    .replace(/<!--[\s\S]*?(?:-->|$)/g, " ")
    .replace(/<(script|style|noscript|svg|template)\b[^>]*>[\s\S]*?(?:<\/\1\s*>|$)/gi, " ");
}

export function extractHtmlTitle(html: string): string | undefined {
  const cleaned = stripNonContentBlocks(html);
  const match = /<title\b[^>]*>([\s\S]*?)<\/title\s*>/i.exec(cleaned);

  if (match === null) return undefined;

  const decoded = decodeHtmlEntities(stripTags(match[1] ?? ""))
    .replace(/\s+/g, " ")
    .trim();
  return decoded.length > 0 ? decoded : undefined;
}

export function htmlToReadableText(html: string): string {
  let text = stripNonContentBlocks(html);

  text = text.replace(
    /<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1\s*>/gi,
    (_m, level: string, inner: string) => {
      const hashes = "#".repeat(Number(level));
      return `\n\n${hashes} ${stripTags(inner).trim()}\n\n`;
    },
  );
  text = text.replace(/<li\b[^>]*>/gi, "\n- ");
  text = text.replace(/<br\s*\/?>/gi, "\n");
  text = text.replace(
    /<\/(p|div|section|article|main|header|footer|tr|blockquote|pre|ul|ol)\s*>/gi,
    "\n\n",
  );
  text = text.replace(/<td\b[^>]*>|<th\b[^>]*>/gi, " | ");

  text = stripTags(text);
  text = decodeHtmlEntities(text);

  const lines = text
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim());

  const compacted: string[] = [];
  let blankRun = 0;
  for (const line of lines) {
    if (line.length === 0) {
      blankRun++;

      if (blankRun <= 1 && compacted.length > 0) compacted.push("");
    } else {
      blankRun = 0;
      compacted.push(line);
    }
  }

  return compacted.join("\n").trim();
}

function stripTags(input: string): string {
  return input.replace(/<[^>]+>/g, " ");
}

function decodeHtmlEntities(input: string): string {
  return input.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, body: string) => {
    const lower = body.toLowerCase();

    if (lower in ENTITY_MAP) {
      return ENTITY_MAP[lower]!;
    }

    if (lower.startsWith("#x")) {
      const codePoint = Number.parseInt(lower.slice(2), 16);
      return Number.isFinite(codePoint) ? safeFromCodePoint(codePoint, match) : match;
    }

    if (lower.startsWith("#")) {
      const codePoint = Number.parseInt(lower.slice(1), 10);
      return Number.isFinite(codePoint) ? safeFromCodePoint(codePoint, match) : match;
    }

    return match;
  });
}

function safeFromCodePoint(codePoint: number, fallback: string): string {
  if (codePoint < 0 || codePoint > 0x10ffff) return fallback;

  return String.fromCodePoint(codePoint);
}
