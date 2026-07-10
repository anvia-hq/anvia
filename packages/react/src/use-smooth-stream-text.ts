import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

export type StreamAnimationMode = "none" | "smooth" | "fadeIn";

export type StreamSmoothingPreset = "realtime" | "balanced" | "silky";

export type UseSmoothStreamTextOptions = {
  enabled?: boolean;
  mode?: StreamAnimationMode;
  isStreaming?: boolean;
  preset?: StreamSmoothingPreset;
  reducedMotion?: boolean;
  largeAppendChars?: number;
};

export type UseSmoothStreamTextResult = {
  text: string;
  isAnimating: boolean;
  flush(): void;
  reset(nextText?: string): void;
};

type SmoothingConfig = {
  fraction: number;
  maxChars: number;
};

const DEFAULT_LARGE_APPEND_CHARS = 500;
const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";
const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;
const smoothingConfigs: Record<StreamSmoothingPreset, SmoothingConfig> = {
  realtime: { fraction: 0.5, maxChars: 24 },
  balanced: { fraction: 0.25, maxChars: 12 },
  silky: { fraction: 0.125, maxChars: 6 },
};

export function useSmoothStreamText(
  content: string,
  options: UseSmoothStreamTextOptions = {},
): UseSmoothStreamTextResult {
  const enabled = options.enabled ?? true;
  const mode = options.mode ?? "smooth";
  const preset = options.preset ?? "balanced";
  const largeAppendChars = options.largeAppendChars ?? DEFAULT_LARGE_APPEND_CHARS;
  const observeReducedMotion = enabled && mode !== "none" && options.isStreaming !== false;
  const systemReducedMotion = useSystemReducedMotion(options.reducedMotion, observeReducedMotion);
  const reducedMotion = options.reducedMotion ?? systemReducedMotion;
  const shouldAnimate =
    enabled && mode !== "none" && options.isStreaming !== false && !reducedMotion;

  const [text, setText] = useState(content);
  const [isAnimating, setIsAnimating] = useState(false);
  const targetRef = useRef(content);
  const targetCharactersRef = useRef([...content]);
  const displayedLengthRef = useRef(targetCharactersRef.current.length);
  const frameRef = useRef<number | undefined>(undefined);
  const mountedRef = useRef(true);
  const shouldAnimateRef = useRef(shouldAnimate);
  const presetRef = useRef(preset);

  shouldAnimateRef.current = shouldAnimate;
  presetRef.current = preset;

  const cancelFrame = useCallback(() => {
    const frame = frameRef.current;
    frameRef.current = undefined;
    if (
      frame !== undefined &&
      typeof window !== "undefined" &&
      typeof window.cancelAnimationFrame === "function"
    ) {
      window.cancelAnimationFrame(frame);
    }
  }, []);

  const syncToTarget = useCallback(() => {
    cancelFrame();
    displayedLengthRef.current = targetCharactersRef.current.length;
    setText(targetRef.current);
    setIsAnimating(false);
  }, [cancelFrame]);

  const scheduleFrame = useCallback(
    function scheduleFrame() {
      if (frameRef.current !== undefined || !mountedRef.current) {
        return;
      }
      if (!shouldAnimateRef.current) {
        syncToTarget();
        return;
      }
      if (typeof window === "undefined" || typeof window.requestAnimationFrame !== "function") {
        syncToTarget();
        return;
      }

      setIsAnimating(true);
      frameRef.current = window.requestAnimationFrame(() => {
        frameRef.current = undefined;
        if (!mountedRef.current) {
          return;
        }
        if (!shouldAnimateRef.current) {
          syncToTarget();
          return;
        }

        const targetCharacters = targetCharactersRef.current;
        const remaining = targetCharacters.length - displayedLengthRef.current;
        if (remaining <= 0) {
          setIsAnimating(false);
          return;
        }

        const config = smoothingConfigs[presetRef.current];
        const revealCount = Math.min(
          config.maxChars,
          Math.max(1, Math.ceil(remaining * config.fraction)),
        );
        const nextLength = Math.min(
          targetCharacters.length,
          displayedLengthRef.current + revealCount,
        );

        displayedLengthRef.current = nextLength;
        setText(targetCharacters.slice(0, nextLength).join(""));

        if (nextLength < targetCharacters.length) {
          scheduleFrame();
        } else {
          setIsAnimating(false);
        }
      });
    },
    [syncToTarget],
  );

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      cancelFrame();
    };
  }, [cancelFrame]);

  useIsomorphicLayoutEffect(() => {
    const previousTarget = targetRef.current;
    const targetCharacters = [...content];
    targetRef.current = content;
    targetCharactersRef.current = targetCharacters;

    if (!shouldAnimate) {
      syncToTarget();
      return;
    }

    if (!content.startsWith(previousTarget)) {
      syncToTarget();
      return;
    }

    if (exceedsCharacterLimit(content.slice(previousTarget.length), largeAppendChars)) {
      syncToTarget();
      return;
    }

    if (displayedLengthRef.current < targetCharacters.length) {
      scheduleFrame();
    }
  }, [content, largeAppendChars, scheduleFrame, shouldAnimate, syncToTarget]);

  const flush = useCallback(() => {
    syncToTarget();
  }, [syncToTarget]);

  const reset = useCallback(
    (nextText = "") => {
      cancelFrame();
      const nextCharacters = [...nextText];
      targetRef.current = nextText;
      targetCharactersRef.current = nextCharacters;
      displayedLengthRef.current = nextCharacters.length;
      setText(nextText);
      setIsAnimating(false);
    },
    [cancelFrame],
  );

  return { text, isAnimating, flush, reset };
}

function useSystemReducedMotion(override: boolean | undefined, observe: boolean): boolean {
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    if (
      !observe ||
      override !== undefined ||
      typeof window === "undefined" ||
      typeof window.matchMedia !== "function"
    ) {
      return;
    }

    const mediaQuery = window.matchMedia(REDUCED_MOTION_QUERY);
    const update = () => {
      setReducedMotion(mediaQuery.matches);
    };

    update();
    if (typeof mediaQuery.addEventListener === "function") {
      mediaQuery.addEventListener("change", update);
    } else {
      mediaQuery.addListener(update);
    }
    return () => {
      if (typeof mediaQuery.removeEventListener === "function") {
        mediaQuery.removeEventListener("change", update);
      } else {
        mediaQuery.removeListener(update);
      }
    };
  }, [observe, override]);

  return reducedMotion;
}

function exceedsCharacterLimit(value: string, limit: number): boolean {
  let count = 0;
  for (const _character of value) {
    count += 1;
    if (count > limit) {
      return true;
    }
  }
  return false;
}
