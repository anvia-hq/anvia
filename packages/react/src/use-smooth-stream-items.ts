import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import {
  advanceStreamSmoothing,
  createStreamSmoothingState,
  flushStreamSmoothing,
  getStreamSmoothingSnapshot,
  type SmoothStreamItemAdapter,
  type StreamSmoothingLifecycle,
  type StreamSmoothingSnapshot,
  type StreamSmoothingState,
  streamSmoothingConfig,
  updateStreamSmoothingTarget,
} from "./stream-smoothing";

export type UseSmoothStreamItemsOptions<T> = StreamSmoothingLifecycle & {
  adapter: SmoothStreamItemAdapter<T>;
};

export type UseSmoothStreamItemsResult<T> = {
  items: readonly T[];
  isAnimating: boolean;
  isDraining: boolean;
  liveItemKey: string | null;
  flush(): void;
};

const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

export function useSmoothStreamItems<T>(
  items: readonly T[],
  options: UseSmoothStreamItemsOptions<T>,
): UseSmoothStreamItemsResult<T> {
  const adapterRef = useRef(options.adapter);
  adapterRef.current = options.adapter;

  const initialNowRef = useRef<number | undefined>(undefined);
  if (initialNowRef.current === undefined) {
    initialNowRef.current = currentTimeMs();
  }
  const stateRef = useRef<StreamSmoothingState<T> | undefined>(undefined);
  if (stateRef.current === undefined) {
    stateRef.current = createStreamSmoothingState(
      items,
      { isStreaming: options.isStreaming, nowMs: initialNowRef.current },
      options.adapter,
    );
  }

  const resetKeyRef = useRef(options.resetKey);
  const animationFrameRef = useRef<number | null>(null);
  const mountedRef = useRef(true);
  const [snapshot, setSnapshot] = useState<StreamSmoothingSnapshot<T>>(() =>
    getStreamSmoothingSnapshot(stateRef.current as StreamSmoothingState<T>, options.adapter),
  );

  const clearAnimationFrame = useCallback(() => {
    const frame = animationFrameRef.current;
    animationFrameRef.current = null;
    if (
      frame !== null &&
      typeof window !== "undefined" &&
      typeof window.cancelAnimationFrame === "function"
    ) {
      window.cancelAnimationFrame(frame);
    }
  }, []);

  const commitState = useCallback((state: StreamSmoothingState<T>) => {
    const adapter = adapterRef.current;
    stateRef.current = state;
    const nextSnapshot = getStreamSmoothingSnapshot(state, adapter);
    setSnapshot((current) =>
      streamSmoothingSnapshotsEqual(current, nextSnapshot, adapter) ? current : nextSnapshot,
    );
  }, []);

  const flushToTarget = useCallback(() => {
    const state = stateRef.current;
    if (state === undefined) {
      return;
    }
    clearAnimationFrame();
    commitState(flushStreamSmoothing(state, currentTimeMs(), adapterRef.current));
  }, [clearAnimationFrame, commitState]);

  const scheduleFrame = useCallback(
    function scheduleFrame() {
      if (animationFrameRef.current !== null || !mountedRef.current) {
        return;
      }
      if (typeof window === "undefined" || typeof window.requestAnimationFrame !== "function") {
        flushToTarget();
        return;
      }

      animationFrameRef.current = window.requestAnimationFrame((nowMs) => {
        animationFrameRef.current = null;
        const state = stateRef.current;
        if (!mountedRef.current || state === undefined) {
          return;
        }
        const minimumCommitIntervalMs = 1_000 / streamSmoothingConfig.maxCommitFps;
        if (nowMs - state.lastAdvanceAtMs + 0.5 < minimumCommitIntervalMs) {
          scheduleFrame();
          return;
        }

        const nextState = advanceStreamSmoothing(state, nowMs, adapterRef.current);
        const nextSnapshot = getStreamSmoothingSnapshot(nextState, adapterRef.current);
        commitState(nextState);
        if (nextSnapshot.hasPendingContent) {
          scheduleFrame();
        }
      });
    },
    [commitState, flushToTarget],
  );

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      clearAnimationFrame();
    };
  }, [clearAnimationFrame]);

  useIsomorphicLayoutEffect(() => {
    const nowMs = currentTimeMs();
    const reset = resetKeyRef.current !== options.resetKey;
    resetKeyRef.current = options.resetKey;
    let nextState = reset
      ? createStreamSmoothingState(
          items,
          { isStreaming: options.isStreaming, nowMs },
          options.adapter,
        )
      : updateStreamSmoothingTarget(
          stateRef.current as StreamSmoothingState<T>,
          items,
          { isStreaming: options.isStreaming, nowMs },
          options.adapter,
        );

    const hidden = typeof document !== "undefined" && document.visibilityState === "hidden";
    if (options.flushImmediately === true || hidden) {
      nextState = flushStreamSmoothing(nextState, nowMs, options.adapter);
    }

    const nextSnapshot = getStreamSmoothingSnapshot(nextState, options.adapter);
    commitState(nextState);
    if (nextSnapshot.hasPendingContent) {
      scheduleFrame();
    } else {
      clearAnimationFrame();
    }
  }, [
    clearAnimationFrame,
    commitState,
    items,
    options.adapter,
    options.flushImmediately,
    options.isStreaming,
    options.resetKey,
    scheduleFrame,
  ]);

  useEffect(() => {
    if (typeof document === "undefined") {
      return;
    }
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        flushToTarget();
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [flushToTarget]);

  return {
    items: snapshot.items,
    isAnimating: snapshot.hasPendingContent,
    isDraining: snapshot.isDraining,
    liveItemKey: snapshot.liveItemKey,
    flush: flushToTarget,
  };
}

function currentTimeMs(): number {
  if (typeof performance !== "undefined" && typeof performance.now === "function") {
    return performance.now();
  }
  return Date.now();
}

function streamSmoothingSnapshotsEqual<T>(
  left: StreamSmoothingSnapshot<T>,
  right: StreamSmoothingSnapshot<T>,
  adapter: SmoothStreamItemAdapter<T>,
): boolean {
  if (
    left.hasPendingContent !== right.hasPendingContent ||
    left.isDraining !== right.isDraining ||
    left.liveItemKey !== right.liveItemKey ||
    left.items.length !== right.items.length
  ) {
    return false;
  }

  return left.items.every((leftItem, index) => {
    const rightItem = right.items[index];
    if (rightItem === undefined || adapter.getKey(leftItem) !== adapter.getKey(rightItem)) {
      return false;
    }
    const leftText = adapter.getText(leftItem);
    const rightText = adapter.getText(rightItem);
    return leftText === undefined ? leftItem === rightItem : leftText === rightText;
  });
}
