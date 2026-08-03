export const streamRevealConfig = {
  bandGraphemes: 2,
  durationMs: 180,
  minimumOpacity: 0.12,
  tailGraphemes: 24,
} as const;

export type StreamRevealLifecycle = {
  activeScope: string | null;
  settledRevealIds: Set<string>;
  startedAtByRevealId: Map<string, number>;
};

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

type RevealGrapheme = {
  endOffset: number;
  opacity: number;
  startOffset: number;
};

export function createStreamGradientRevealPlugin(
  lifecycleScope: string,
  lifecycle: StreamRevealLifecycle,
) {
  return function streamGradientRevealPlugin() {
    return (tree: MarkdownNode) => {
      if (lifecycle.activeScope !== lifecycleScope) {
        lifecycle.activeScope = lifecycleScope;
        lifecycle.settledRevealIds.clear();
        lifecycle.startedAtByRevealId.clear();
      }
      const targets = collectTextTargets(tree);
      const renderedText = targets.map((target) => target.node.value ?? "").join("");
      const graphemes = createRevealGraphemes(renderedText);
      wrapStreamRevealGraphemes(targets, graphemes, lifecycleScope, lifecycle);
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

function createRevealGraphemes(content: string): RevealGrapheme[] {
  const tail = segmentTailGraphemeRanges(content, streamRevealConfig.tailGraphemes);
  const graphemes: RevealGrapheme[] = [];

  for (let index = 0; index < tail.length; index += 1) {
    const grapheme = tail[index];
    const bandStartIndex =
      Math.floor(index / streamRevealConfig.bandGraphemes) * streamRevealConfig.bandGraphemes;
    const bandEndIndex =
      Math.min(bandStartIndex + streamRevealConfig.bandGraphemes, tail.length) - 1;
    if (grapheme === undefined) {
      continue;
    }
    const progress = tail.length === 1 ? 1 : bandEndIndex / (tail.length - 1);
    graphemes.push({
      startOffset: grapheme.startOffset,
      endOffset: grapheme.endOffset,
      opacity: Math.max(
        streamRevealConfig.minimumOpacity,
        1 - progress * (1 - streamRevealConfig.minimumOpacity),
      ),
    });
  }
  return graphemes;
}

function wrapStreamRevealGraphemes(
  targets: readonly TextTarget[],
  graphemes: readonly RevealGrapheme[],
  lifecycleScope: string,
  lifecycle: StreamRevealLifecycle,
): void {
  const activeRevealIds = new Set<string>();
  const nowMs = Date.now();
  for (const target of [...targets].reverse()) {
    const value = target.node.value ?? "";
    const intersectingGraphemes = graphemes.filter(
      (grapheme) =>
        grapheme.endOffset > target.startOffset && grapheme.startOffset < target.endOffset,
    );
    if (intersectingGraphemes.length === 0) {
      continue;
    }

    const replacement: MarkdownNode[] = [];
    let cursor = 0;
    for (const grapheme of intersectingGraphemes) {
      const start = Math.max(0, grapheme.startOffset - target.startOffset);
      const end = Math.min(value.length, grapheme.endOffset - target.startOffset);
      if (start > cursor) {
        replacement.push({ type: "text", value: value.slice(cursor, start) });
      }
      if (end > start) {
        const text = value.slice(start, end);
        const absoluteStart = target.startOffset + start;
        const absoluteEnd = target.startOffset + end;
        const revealId = `${lifecycleScope}:${absoluteStart}:${absoluteEnd}:${hashText(text)}`;
        activeRevealIds.add(revealId);
        const startedAt = lifecycle.startedAtByRevealId.get(revealId) ?? nowMs;
        lifecycle.startedAtByRevealId.set(revealId, startedAt);
        const elapsedMs = Math.max(0, nowMs - startedAt);
        if (elapsedMs >= streamRevealConfig.durationMs) {
          lifecycle.settledRevealIds.add(revealId);
        }
        if (lifecycle.settledRevealIds.has(revealId)) {
          replacement.push({ type: "text", value: text });
        } else {
          const progress = Math.min(elapsedMs / streamRevealConfig.durationMs, 1);
          const opacity = grapheme.opacity + (1 - grapheme.opacity) * progress;
          const remainingMs = Math.max(1, streamRevealConfig.durationMs - elapsedMs);
          replacement.push({
            type: "element",
            tagName: "span",
            properties: {
              "data-anvia-stream-duration-ms": String(remainingMs),
              "data-anvia-stream-opacity": String(opacity),
              "data-anvia-stream-reveal": "",
              "data-anvia-stream-reveal-id": revealId,
            },
            children: [{ type: "text", value: text }],
          });
        }
      }
      cursor = Math.max(cursor, end);
    }
    if (cursor < value.length) {
      replacement.push({ type: "text", value: value.slice(cursor) });
    }
    target.parent.children?.splice(target.index, 1, ...replacement);
  }

  pruneRevealLifecycle(lifecycle, activeRevealIds);
}

function pruneRevealLifecycle(
  lifecycle: StreamRevealLifecycle,
  activeRevealIds: ReadonlySet<string>,
): void {
  for (const revealId of lifecycle.startedAtByRevealId.keys()) {
    if (!activeRevealIds.has(revealId)) lifecycle.startedAtByRevealId.delete(revealId);
  }
  for (const revealId of lifecycle.settledRevealIds) {
    if (!activeRevealIds.has(revealId)) lifecycle.settledRevealIds.delete(revealId);
  }
}

function hashText(text: string): string {
  let hash = 2_166_136_261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0).toString(36);
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
