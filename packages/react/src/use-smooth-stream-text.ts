import { useMemo } from "react";

import type { SmoothStreamItemAdapter, StreamSmoothingLifecycle } from "./stream-smoothing";
import { useSmoothStreamItems } from "./use-smooth-stream-items";

export type UseSmoothStreamTextOptions = StreamSmoothingLifecycle;

export type UseSmoothStreamTextResult = {
  text: string;
  isAnimating: boolean;
  isDraining: boolean;
  flush(): void;
};

type TextStreamItem = {
  key: "text";
  text: string;
};

const textStreamAdapter: SmoothStreamItemAdapter<TextStreamItem> = {
  getKey: (item) => item.key,
  getText: (item) => item.text,
  withText: (item, text) => (item.text === text ? item : { ...item, text }),
};

export function useSmoothStreamText(
  content: string,
  options: UseSmoothStreamTextOptions,
): UseSmoothStreamTextResult {
  const items = useMemo<readonly TextStreamItem[]>(
    () => [{ key: "text", text: content }],
    [content],
  );
  const smooth = useSmoothStreamItems(items, {
    adapter: textStreamAdapter,
    isStreaming: options.isStreaming,
    resetKey: options.resetKey,
    ...(options.flushImmediately === undefined
      ? {}
      : { flushImmediately: options.flushImmediately }),
  });

  return {
    text: smooth.items[0]?.text ?? "",
    isAnimating: smooth.isAnimating,
    isDraining: smooth.isDraining,
    flush: smooth.flush,
  };
}
