export type TextChunk = Readonly<{
  index: number;
  text: string;
  start: number;
  end: number;
}>;

export type ChunkTextOptions =
  | Readonly<{
      text: string;
      strategy: "fixed";
      maxSize: number;
      overlap?: number;
    }>
  | Readonly<{
      text: string;
      strategy: "recursive";
      maxSize: number;
      overlap?: number;
      separators: readonly string[];
    }>;

type TextRange = Readonly<{
  start: number;
  end: number;
}>;

export function chunkText(options: ChunkTextOptions): readonly TextChunk[] {
  const validated = validateOptions(options);
  if (validated.text.length === 0) {
    return [];
  }

  if (validated.strategy === "fixed") {
    return chunkFixed(validated.text, validated.maxSize, validated.overlap);
  }

  const ranges = splitRecursive(
    validated.text,
    { start: 0, end: validated.text.length },
    validated.maxSize,
    validated.separators,
    0,
  );
  return applyRecursiveOverlap(validated.text, ranges, validated.maxSize, validated.overlap);
}

function validateOptions(options: ChunkTextOptions):
  | Readonly<{
      text: string;
      strategy: "fixed";
      maxSize: number;
      overlap: number;
    }>
  | Readonly<{
      text: string;
      strategy: "recursive";
      maxSize: number;
      overlap: number;
      separators: readonly string[];
    }> {
  if (typeof options !== "object" || options === null) {
    throw new TypeError("chunkText options must be an object");
  }

  const value = options as unknown as Record<string, unknown>;
  if (typeof value.text !== "string") {
    throw new TypeError("chunkText text must be a string");
  }
  if (!Number.isSafeInteger(value.maxSize) || (value.maxSize as number) <= 0) {
    throw new RangeError("chunkText maxSize must be a positive safe integer");
  }

  const maxSize = value.maxSize as number;
  const overlap = value.overlap === undefined ? 0 : value.overlap;
  if (!Number.isSafeInteger(overlap) || (overlap as number) < 0 || (overlap as number) >= maxSize) {
    throw new RangeError(
      "chunkText overlap must be a non-negative safe integer smaller than maxSize",
    );
  }

  if (value.strategy === "fixed") {
    if ("separators" in value) {
      throw new TypeError("chunkText fixed strategy does not accept separators");
    }
    return {
      text: value.text,
      strategy: "fixed",
      maxSize,
      overlap: overlap as number,
    };
  }

  if (value.strategy !== "recursive") {
    throw new TypeError('chunkText strategy must be either "fixed" or "recursive"');
  }
  if (!Array.isArray(value.separators) || value.separators.length === 0) {
    throw new TypeError("chunkText recursive separators must be a non-empty array");
  }

  const separators = value.separators as unknown[];
  const seen = new Set<string>();
  for (const separator of separators) {
    if (typeof separator !== "string" || separator.length === 0) {
      throw new TypeError("chunkText recursive separators must contain non-empty strings");
    }
    if (seen.has(separator)) {
      throw new TypeError("chunkText recursive separators must not contain duplicates");
    }
    seen.add(separator);
  }

  return {
    text: value.text,
    strategy: "recursive",
    maxSize,
    overlap: overlap as number,
    separators: separators as string[],
  };
}

function chunkFixed(text: string, maxSize: number, overlap: number): readonly TextChunk[] {
  const chunks: TextChunk[] = [];
  let start = 0;

  while (start < text.length) {
    const end = Math.min(start + maxSize, text.length);
    chunks.push(createChunk(text, chunks.length, start, end));
    if (end === text.length) {
      break;
    }
    start = end - overlap;
  }

  return chunks;
}

function splitRecursive(
  text: string,
  range: TextRange,
  maxSize: number,
  separators: readonly string[],
  separatorIndex: number,
): readonly TextRange[] {
  if (range.end - range.start <= maxSize) {
    return [range];
  }
  if (separatorIndex >= separators.length) {
    return hardSplit(range, maxSize);
  }

  const pieces = splitAfterSeparator(text, range, separators[separatorIndex] as string);
  if (pieces.length <= 1) {
    return splitRecursive(text, range, maxSize, separators, separatorIndex + 1);
  }

  const resolved = pieces.flatMap((piece) =>
    piece.end - piece.start <= maxSize
      ? [piece]
      : splitRecursive(text, piece, maxSize, separators, separatorIndex + 1),
  );
  return packAdjacent(resolved, maxSize);
}

function splitAfterSeparator(text: string, range: TextRange, separator: string): TextRange[] {
  const ranges: TextRange[] = [];
  let start = range.start;
  let searchFrom = range.start;

  while (searchFrom < range.end) {
    const separatorStart = text.indexOf(separator, searchFrom);
    if (separatorStart < 0 || separatorStart + separator.length > range.end) {
      break;
    }
    const end = separatorStart + separator.length;
    if (end > start) {
      ranges.push({ start, end });
    }
    start = end;
    searchFrom = end;
  }

  if (start < range.end) {
    ranges.push({ start, end: range.end });
  }
  return ranges;
}

function hardSplit(range: TextRange, maxSize: number): readonly TextRange[] {
  const ranges: TextRange[] = [];
  for (let start = range.start; start < range.end; start += maxSize) {
    ranges.push({ start, end: Math.min(start + maxSize, range.end) });
  }
  return ranges;
}

function packAdjacent(ranges: readonly TextRange[], maxSize: number): readonly TextRange[] {
  const first = ranges[0];
  if (first === undefined) {
    return [];
  }

  const packed: TextRange[] = [];
  let current = first;
  for (const range of ranges.slice(1)) {
    if (range.end - current.start <= maxSize) {
      current = { start: current.start, end: range.end };
    } else {
      packed.push(current);
      current = range;
    }
  }
  packed.push(current);
  return packed;
}

function applyRecursiveOverlap(
  text: string,
  ranges: readonly TextRange[],
  maxSize: number,
  overlap: number,
): readonly TextChunk[] {
  const boundaries = ranges.map((range) => range.end);
  const chunks: TextChunk[] = [];
  let start = 0;
  let previousEnd = 0;

  while (start < text.length) {
    const limit = Math.min(start + maxSize, text.length);
    const boundary = findLastBoundaryAtMost(boundaries, limit);
    const end = boundary !== undefined && boundary > previousEnd ? boundary : limit;

    chunks.push(createChunk(text, chunks.length, start, end));
    if (end === text.length) {
      break;
    }
    previousEnd = end;
    start = Math.max(0, end - overlap);
  }

  return chunks;
}

function findLastBoundaryAtMost(boundaries: readonly number[], limit: number): number | undefined {
  let low = 0;
  let high = boundaries.length;
  while (low < high) {
    const middle = low + Math.floor((high - low) / 2);
    if ((boundaries[middle] as number) <= limit) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }
  return boundaries[low - 1];
}

function createChunk(text: string, index: number, start: number, end: number): TextChunk {
  return { index, text: text.slice(start, end), start, end };
}
