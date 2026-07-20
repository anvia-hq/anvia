export const streamRevealConfig = {
  bandGraphemes: 2,
  minimumOpacity: 0.12,
  tailGraphemes: 24,
} as const;

type MarkdownNode = {
  type: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: MarkdownNode[];
};

type TextTarget = {
  endOffset: number;
  index: number;
  node: MarkdownNode;
  parent: MarkdownNode;
  startOffset: number;
};

type RevealBand = {
  endOffset: number;
  opacity: number;
  startOffset: number;
};

export function createStreamGradientRevealPlugin(frameId: number) {
  return function streamGradientRevealPlugin() {
    return (tree: MarkdownNode) => {
      const targets = collectTextTargets(tree);
      const renderedText = targets.map((target) => target.node.value ?? "").join("");
      const bands = createRevealBands(renderedText);
      wrapStreamRevealBands(targets, bands, frameId);
    };
  };
}

function collectTextTargets(tree: MarkdownNode): TextTarget[] {
  const targets: TextTarget[] = [];
  let offset = 0;

  function visit(node: MarkdownNode, parent: MarkdownNode | undefined, index: number): void {
    if (node.type === "element" && node.tagName === "pre") {
      return;
    }
    if (node.type === "text" && node.value !== undefined && parent !== undefined) {
      if (!/\S/u.test(node.value)) {
        return;
      }
      const startOffset = offset;
      offset += node.value.length;
      targets.push({
        endOffset: offset,
        index,
        node,
        parent,
        startOffset,
      });
      return;
    }
    for (const [childIndex, child] of (node.children ?? []).entries()) {
      visit(child, node, childIndex);
    }
  }

  visit(tree, undefined, 0);
  return targets;
}

function createRevealBands(content: string): RevealBand[] {
  const tail = segmentTailGraphemeRanges(content, streamRevealConfig.tailGraphemes);
  const bands: RevealBand[] = [];

  for (let index = 0; index < tail.length; index += streamRevealConfig.bandGraphemes) {
    const first = tail[index];
    const endIndex = Math.min(index + streamRevealConfig.bandGraphemes, tail.length) - 1;
    const last = tail[endIndex];
    if (first === undefined || last === undefined) {
      continue;
    }
    const progress = tail.length === 1 ? 1 : endIndex / (tail.length - 1);
    bands.push({
      startOffset: first.startOffset,
      endOffset: last.endOffset,
      opacity: Math.max(
        streamRevealConfig.minimumOpacity,
        1 - progress * (1 - streamRevealConfig.minimumOpacity),
      ),
    });
  }
  return bands;
}

function wrapStreamRevealBands(
  targets: readonly TextTarget[],
  bands: readonly RevealBand[],
  frameId: number,
): void {
  for (const target of [...targets].reverse()) {
    const value = target.node.value ?? "";
    const intersectingBands = bands.filter(
      (band) => band.endOffset > target.startOffset && band.startOffset < target.endOffset,
    );
    if (intersectingBands.length === 0) {
      continue;
    }

    const replacement: MarkdownNode[] = [];
    let cursor = 0;
    for (const band of intersectingBands) {
      const start = Math.max(0, band.startOffset - target.startOffset);
      const end = Math.min(value.length, band.endOffset - target.startOffset);
      if (start > cursor) {
        replacement.push({ type: "text", value: value.slice(cursor, start) });
      }
      if (end > start) {
        replacement.push({
          type: "element",
          tagName: "span",
          properties: {
            "data-anvia-stream-frame-id": `${frameId}:${band.startOffset}`,
            "data-anvia-stream-opacity": String(band.opacity),
            "data-anvia-stream-reveal": "",
          },
          children: [{ type: "text", value: value.slice(start, end) }],
        });
      }
      cursor = Math.max(cursor, end);
    }
    if (cursor < value.length) {
      replacement.push({ type: "text", value: value.slice(cursor) });
    }
    target.parent.children?.splice(target.index, 1, ...replacement);
  }
}

function segmentTailGraphemeRanges(
  content: string,
  limit: number,
): Array<{
  endOffset: number;
  startOffset: number;
}> {
  if (typeof Intl !== "undefined" && typeof Intl.Segmenter === "function") {
    const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
    const segments = segmenter.segment(content);
    const ranges: Array<{ endOffset: number; startOffset: number }> = [];
    let cursor = content.length;
    while (cursor > 0 && ranges.length < limit) {
      const segment = segments.containing(cursor - 1);
      if (segment === undefined) {
        break;
      }
      ranges.unshift({
        startOffset: segment.index,
        endOffset: segment.index + segment.segment.length,
      });
      cursor = segment.index;
    }
    return ranges;
  }

  const ranges: Array<{ endOffset: number; startOffset: number }> = [];
  let cursor = content.length;
  while (cursor > 0 && ranges.length < limit) {
    let startOffset = cursor - 1;
    const code = content.charCodeAt(startOffset);
    if (code >= 0xdc00 && code <= 0xdfff && startOffset > 0) {
      const previousCode = content.charCodeAt(startOffset - 1);
      if (previousCode >= 0xd800 && previousCode <= 0xdbff) {
        startOffset -= 1;
      }
    }
    ranges.unshift({ startOffset, endOffset: cursor });
    cursor = startOffset;
  }
  return ranges;
}
