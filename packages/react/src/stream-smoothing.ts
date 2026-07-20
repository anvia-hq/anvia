export type StreamSmoothingLifecycle = {
  isStreaming: boolean;
  resetKey: string | number;
  flushImmediately?: boolean;
};

export type SmoothStreamItemAdapter<T> = {
  getKey(item: T): string;
  getText(item: T): string | undefined;
  withText(item: T, text: string): T;
};

export type StreamSourceSample = {
  atMs: number;
  totalChars: number;
};

export type StreamSmoothingState<T> = {
  displayedItems: T[];
  drainDeadlineAtMs: number | null;
  isSourceStreaming: boolean;
  lastAdvanceAtMs: number;
  playbackCursorChars: number;
  sourceSamples: StreamSourceSample[];
  targetItems: T[];
};

export type StreamSmoothingSnapshot<T> = {
  hasPendingContent: boolean;
  isDraining: boolean;
  items: readonly T[];
  liveItemKey: string | null;
};

export const streamSmoothingConfig = {
  baseCharsPerSecond: 140,
  completionDrainMs: 700,
  initialSampleSpreadMs: 50,
  maxCommitFps: 60,
  maxCompletionCharsPerFrame: 30,
  maxCompletionCharsPerSecond: 1_600,
  maxElapsedMs: 64,
  maxPendingChars: 1_000,
  maxSourceSamples: 64,
  maxStreamingCharsPerFrame: 6,
  maxStreamingCharsPerSecond: 360,
  sourceGapResetMs: 180,
  sourceInterpolationMs: 100,
  streamingBaseCharsPerSecond: 200,
  streamingDrainMs: 250,
  targetBufferMs: 225,
} as const;

export function createStreamSmoothingState<T>(
  items: readonly T[],
  options: { isStreaming: boolean; nowMs: number },
  adapter: SmoothStreamItemAdapter<T>,
): StreamSmoothingState<T> {
  const targetItems = [...items];
  const totalChars = getSmoothCharacterCount(targetItems, adapter);
  return {
    displayedItems: targetItems,
    drainDeadlineAtMs: null,
    isSourceStreaming: options.isStreaming,
    lastAdvanceAtMs: options.nowMs,
    playbackCursorChars: totalChars,
    sourceSamples: [{ atMs: options.nowMs, totalChars }],
    targetItems,
  };
}

export function updateStreamSmoothingTarget<T>(
  state: StreamSmoothingState<T>,
  items: readonly T[],
  options: { isStreaming: boolean; nowMs: number },
  adapter: SmoothStreamItemAdapter<T>,
): StreamSmoothingState<T> {
  const targetItems = [...items];

  if (!state.isSourceStreaming && !options.isStreaming) {
    return createStreamSmoothingState(targetItems, options, adapter);
  }

  const previousTargetChars = getSmoothCharacterCount(state.targetItems, adapter);
  const targetChars = getSmoothCharacterCount(targetItems, adapter);
  let displayedItems = reconcileDisplayedItems(state.displayedItems, targetItems, adapter);
  displayedItems = revealWithinBudget(displayedItems, targetItems, 0, adapter);

  let sourceSamples = state.sourceSamples;
  if (options.isStreaming) {
    sourceSamples = updateSourceSamples(
      sourceSamples,
      previousTargetChars,
      targetChars,
      options.nowMs,
    );
  }

  let nextState: StreamSmoothingState<T> = {
    ...state,
    displayedItems,
    drainDeadlineAtMs:
      options.isStreaming || state.drainDeadlineAtMs !== null
        ? options.isStreaming
          ? null
          : state.drainDeadlineAtMs
        : options.nowMs + streamSmoothingConfig.completionDrainMs,
    isSourceStreaming: options.isStreaming,
    sourceSamples,
    targetItems,
  };

  nextState = applyBackpressure(nextState, adapter);

  if (!options.isStreaming && !hasPendingContent(nextState, adapter)) {
    return {
      ...nextState,
      displayedItems: targetItems,
      drainDeadlineAtMs: null,
      playbackCursorChars: targetChars,
    };
  }

  if (!options.isStreaming && nextState.drainDeadlineAtMs === null) {
    nextState = {
      ...nextState,
      drainDeadlineAtMs: options.nowMs + streamSmoothingConfig.completionDrainMs,
    };
  }

  return nextState;
}

export function advanceStreamSmoothing<T>(
  state: StreamSmoothingState<T>,
  nowMs: number,
  adapter: SmoothStreamItemAdapter<T>,
): StreamSmoothingState<T> {
  const elapsedMs = Math.min(
    Math.max(nowMs - state.lastAdvanceAtMs, 0),
    streamSmoothingConfig.maxElapsedMs,
  );
  const displayedChars = getSmoothCharacterCount(state.displayedItems, adapter);
  const targetChars = getSmoothCharacterCount(state.targetItems, adapter);
  const pendingChars = Math.max(0, targetChars - displayedChars);
  const playbackTargetChars = state.isSourceStreaming
    ? getBufferedPlaybackTarget(state.sourceSamples, nowMs)
    : targetChars;
  const playbackPendingChars = Math.max(0, playbackTargetChars - displayedChars);
  const charsPerSecond = state.isSourceStreaming
    ? getStreamingCharsPerSecond(playbackPendingChars)
    : getCompletionCharsPerSecond(pendingChars, state.drainDeadlineAtMs, nowMs);
  const playbackCursorChars = Math.min(
    playbackTargetChars,
    Math.max(state.playbackCursorChars, displayedChars) + (elapsedMs / 1_000) * charsPerSecond,
  );
  const requestedBudget = Math.max(0, Math.floor(playbackCursorChars - displayedChars));
  const frameBudget = Math.min(
    requestedBudget,
    state.isSourceStreaming
      ? streamSmoothingConfig.maxStreamingCharsPerFrame
      : streamSmoothingConfig.maxCompletionCharsPerFrame,
  );
  const revealedItems = revealWithinBudget(
    state.displayedItems,
    state.targetItems,
    frameBudget,
    adapter,
  );
  const nextDisplayedChars = getSmoothCharacterCount(revealedItems, adapter);
  const pending = hasPendingItems(revealedItems, state.targetItems, adapter);

  return {
    ...state,
    displayedItems: pending ? revealedItems : state.targetItems,
    drainDeadlineAtMs: !state.isSourceStreaming && !pending ? null : state.drainDeadlineAtMs,
    lastAdvanceAtMs: nowMs,
    playbackCursorChars: Math.max(playbackCursorChars, nextDisplayedChars),
  };
}

export function flushStreamSmoothing<T>(
  state: StreamSmoothingState<T>,
  nowMs: number,
  adapter: SmoothStreamItemAdapter<T>,
): StreamSmoothingState<T> {
  const targetChars = getSmoothCharacterCount(state.targetItems, adapter);
  return {
    ...state,
    displayedItems: state.targetItems,
    drainDeadlineAtMs: null,
    lastAdvanceAtMs: nowMs,
    playbackCursorChars: targetChars,
    sourceSamples: [{ atMs: nowMs, totalChars: targetChars }],
  };
}

export function getStreamSmoothingSnapshot<T>(
  state: StreamSmoothingState<T>,
  adapter: SmoothStreamItemAdapter<T>,
): StreamSmoothingSnapshot<T> {
  const pending = hasPendingContent(state, adapter);
  const active = state.isSourceStreaming || pending;
  const lastItem = state.displayedItems.at(-1);
  const liveItemKey =
    active && lastItem !== undefined && adapter.getText(lastItem) !== undefined
      ? adapter.getKey(lastItem)
      : null;

  return {
    hasPendingContent: pending,
    isDraining: !state.isSourceStreaming && pending,
    items: state.displayedItems,
    liveItemKey,
  };
}

export function getBufferedPlaybackTarget(
  samples: readonly StreamSourceSample[],
  nowMs: number,
): number {
  const playbackAtMs = nowMs - streamSmoothingConfig.targetBufferMs;
  const firstSample = samples[0];
  if (firstSample === undefined) {
    return 0;
  }
  if (playbackAtMs <= firstSample.atMs) {
    return firstSample.totalChars;
  }

  for (let index = 1; index < samples.length; index += 1) {
    const previousSample = samples[index - 1];
    const nextSample = samples[index];
    if (
      previousSample === undefined ||
      nextSample === undefined ||
      playbackAtMs > nextSample.atMs
    ) {
      continue;
    }

    const durationMs = Math.max(nextSample.atMs - previousSample.atMs, 1);
    const progress = Math.min(Math.max((playbackAtMs - previousSample.atMs) / durationMs, 0), 1);
    return (
      previousSample.totalChars + (nextSample.totalChars - previousSample.totalChars) * progress
    );
  }

  return samples.at(-1)?.totalChars ?? 0;
}

function updateSourceSamples(
  samples: readonly StreamSourceSample[],
  previousTotalChars: number,
  targetChars: number,
  nowMs: number,
): StreamSourceSample[] {
  if (targetChars === previousTotalChars) {
    return [...samples];
  }

  if (targetChars < previousTotalChars) {
    return [
      {
        atMs: nowMs - streamSmoothingConfig.initialSampleSpreadMs,
        totalChars: Math.min(previousTotalChars, targetChars),
      },
      { atMs: nowMs, totalChars: targetChars },
    ];
  }

  const nextSamples = [...samples];
  const lastSample = nextSamples.at(-1);
  if (lastSample === undefined) {
    nextSamples.push({
      atMs: nowMs - streamSmoothingConfig.initialSampleSpreadMs,
      totalChars: previousTotalChars,
    });
  } else if (nowMs - lastSample.atMs > streamSmoothingConfig.sourceGapResetMs) {
    nextSamples.push({
      atMs: nowMs - streamSmoothingConfig.sourceInterpolationMs,
      totalChars: previousTotalChars,
    });
  }
  nextSamples.push({ atMs: nowMs, totalChars: targetChars });
  return nextSamples.slice(-streamSmoothingConfig.maxSourceSamples);
}

function applyBackpressure<T>(
  state: StreamSmoothingState<T>,
  adapter: SmoothStreamItemAdapter<T>,
): StreamSmoothingState<T> {
  const displayedChars = getSmoothCharacterCount(state.displayedItems, adapter);
  const targetChars = getSmoothCharacterCount(state.targetItems, adapter);
  const excess = targetChars - displayedChars - streamSmoothingConfig.maxPendingChars;
  if (excess <= 0) {
    return state;
  }

  const revealedItems = revealWithinBudget(
    state.displayedItems,
    state.targetItems,
    excess,
    adapter,
    true,
  );
  const nextDisplayedChars = getSmoothCharacterCount(revealedItems, adapter);
  return {
    ...state,
    displayedItems: revealedItems,
    playbackCursorChars: Math.max(state.playbackCursorChars, nextDisplayedChars),
  };
}

function revealWithinBudget<T>(
  displayedItems: readonly T[],
  targetItems: readonly T[],
  budget: number,
  adapter: SmoothStreamItemAdapter<T>,
  preferSemanticBoundary = false,
): T[] {
  const nextItems: T[] = [];
  let remainingBudget = Math.max(0, budget);

  for (let index = 0; index < targetItems.length; index += 1) {
    const targetItem = targetItems[index];
    if (targetItem === undefined) {
      continue;
    }
    const displayedItem = displayedItems[index];
    const displayedMatches =
      displayedItem !== undefined && adapter.getKey(displayedItem) === adapter.getKey(targetItem);
    const targetText = adapter.getText(targetItem);

    if (targetText === undefined) {
      if (displayedMatches || index === nextItems.length) {
        nextItems.push(targetItem);
        continue;
      }
      break;
    }

    const displayedText =
      displayedMatches && displayedItem !== undefined ? (adapter.getText(displayedItem) ?? "") : "";
    if (displayedText === targetText) {
      nextItems.push(targetItem);
      continue;
    }

    if (remainingBudget <= 0) {
      if (displayedMatches || displayedText.length > 0) {
        nextItems.push(adapter.withText(targetItem, displayedText));
      }
      break;
    }

    const requestedLength = Math.min(targetText.length, displayedText.length + remainingBudget);
    const nextLength = preferSemanticBoundary
      ? findSemanticBoundaryAtOrAfter(targetText, requestedLength)
      : findGraphemeBoundaryAtOrAfter(targetText, requestedLength);
    const nextText = targetText.slice(0, nextLength);
    const revealed = Math.max(0, nextText.length - displayedText.length);
    remainingBudget = Math.max(0, remainingBudget - revealed);

    if (nextLength < targetText.length) {
      nextItems.push(adapter.withText(targetItem, nextText));
      break;
    }

    nextItems.push(targetItem);
  }

  return nextItems;
}

function reconcileDisplayedItems<T>(
  displayedItems: readonly T[],
  targetItems: readonly T[],
  adapter: SmoothStreamItemAdapter<T>,
): T[] {
  const nextItems: T[] = [];

  for (let index = 0; index < targetItems.length; index += 1) {
    const targetItem = targetItems[index];
    const displayedItem = displayedItems[index];
    if (
      targetItem === undefined ||
      displayedItem === undefined ||
      adapter.getKey(targetItem) !== adapter.getKey(displayedItem)
    ) {
      break;
    }

    const targetText = adapter.getText(targetItem);
    const displayedText = adapter.getText(displayedItem);
    if (targetText === undefined) {
      nextItems.push(targetItem);
      if (displayedText !== undefined) {
        continue;
      }
      continue;
    }

    if (displayedText === undefined) {
      nextItems.push(adapter.withText(targetItem, ""));
      break;
    }
    if (targetText.startsWith(displayedText)) {
      nextItems.push(
        displayedText === targetText ? targetItem : adapter.withText(targetItem, displayedText),
      );
      continue;
    }

    const commonPrefixLength = findCommonGraphemePrefixLength(displayedText, targetText);
    nextItems.push(adapter.withText(targetItem, targetText.slice(0, commonPrefixLength)));
    break;
  }

  return nextItems;
}

function hasPendingContent<T>(
  state: StreamSmoothingState<T>,
  adapter: SmoothStreamItemAdapter<T>,
): boolean {
  return hasPendingItems(state.displayedItems, state.targetItems, adapter);
}

function hasPendingItems<T>(
  displayedItems: readonly T[],
  targetItems: readonly T[],
  adapter: SmoothStreamItemAdapter<T>,
): boolean {
  if (displayedItems.length !== targetItems.length) {
    return true;
  }
  return targetItems.some((targetItem, index) => {
    const displayedItem = displayedItems[index];
    if (
      displayedItem === undefined ||
      adapter.getKey(displayedItem) !== adapter.getKey(targetItem)
    ) {
      return true;
    }
    const targetText = adapter.getText(targetItem);
    const displayedText = adapter.getText(displayedItem);
    return targetText === undefined ? displayedItem !== targetItem : displayedText !== targetText;
  });
}

function getSmoothCharacterCount<T>(
  items: readonly T[],
  adapter: SmoothStreamItemAdapter<T>,
): number {
  return items.reduce((total, item) => total + (adapter.getText(item)?.length ?? 0), 0);
}

function getStreamingCharsPerSecond(pendingChars: number): number {
  return Math.min(
    streamSmoothingConfig.maxStreamingCharsPerSecond,
    Math.max(
      streamSmoothingConfig.streamingBaseCharsPerSecond,
      pendingChars / (streamSmoothingConfig.streamingDrainMs / 1_000),
    ),
  );
}

function getCompletionCharsPerSecond(
  pendingChars: number,
  deadlineAtMs: number | null,
  nowMs: number,
): number {
  const remainingMs = Math.max((deadlineAtMs ?? nowMs) - nowMs, 1);
  return Math.min(
    streamSmoothingConfig.maxCompletionCharsPerSecond,
    Math.max(streamSmoothingConfig.baseCharsPerSecond, pendingChars / (remainingMs / 1_000)),
  );
}

function findCommonGraphemePrefixLength(left: string, right: string): number {
  const leftSegments = segmentGraphemes(left);
  const rightSegments = segmentGraphemes(right);
  const length = Math.min(leftSegments.length, rightSegments.length);
  let offset = 0;
  for (let index = 0; index < length; index += 1) {
    const leftSegment = leftSegments[index];
    const rightSegment = rightSegments[index];
    if (leftSegment === undefined || leftSegment !== rightSegment) {
      break;
    }
    offset += leftSegment.length;
  }
  return offset;
}

function findSemanticBoundaryAtOrAfter(content: string, requestedLength: number): number {
  const safeRequestedLength = findGraphemeBoundaryAtOrAfter(content, requestedLength);
  const scanEnd = Math.min(content.length, safeRequestedLength + 64);
  for (let index = safeRequestedLength; index < scanEnd; index += 1) {
    const character = content[index];
    if (character === "\n") {
      return findGraphemeBoundaryAtOrAfter(content, index + 1);
    }
    if (
      (character === "." || character === "!" || character === "?") &&
      /\s/u.test(content[index + 1] ?? "")
    ) {
      return findGraphemeBoundaryAtOrAfter(content, index + 1);
    }
    if (/\s/u.test(character ?? "")) {
      return findGraphemeBoundaryAtOrAfter(content, index + 1);
    }
  }
  return safeRequestedLength;
}

function findGraphemeBoundaryAtOrAfter(content: string, requestedLength: number): number {
  const clampedLength = Math.min(Math.max(requestedLength, 0), content.length);
  if (clampedLength === 0 || clampedLength === content.length) {
    return clampedLength;
  }

  const segmenter = createGraphemeSegmenter();
  if (segmenter !== undefined) {
    const segment = segmenter.segment(content).containing(clampedLength - 1);
    if (segment !== undefined) {
      return segment.index + segment.segment.length;
    }
    return content.length;
  }

  const code = content.charCodeAt(clampedLength - 1);
  if (code >= 0xd800 && code <= 0xdbff) {
    return Math.min(content.length, clampedLength + 1);
  }
  return clampedLength;
}

function segmentGraphemes(content: string): string[] {
  const segmenter = createGraphemeSegmenter();
  if (segmenter !== undefined) {
    return [...segmenter.segment(content)].map((segment) => segment.segment);
  }
  return [...content];
}

function createGraphemeSegmenter(): Intl.Segmenter | undefined {
  if (typeof Intl === "undefined" || typeof Intl.Segmenter !== "function") {
    return undefined;
  }
  return new Intl.Segmenter(undefined, { granularity: "grapheme" });
}
