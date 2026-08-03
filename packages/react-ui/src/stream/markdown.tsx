import {
  type ComponentPropsWithoutRef,
  type CSSProperties,
  createElement,
  forwardRef,
  memo,
  type ReactNode,
  useCallback,
  useMemo,
  useRef,
} from "react";
import ReactMarkdown, {
  type Components,
  type Options as ReactMarkdownOptions,
} from "react-markdown";
import remarkGfm from "remark-gfm";

import { type PrimitiveProps, renderPrimitive } from "../primitives";
import { splitStreamMarkdownBlocks } from "./markdown-blocks";
import { createStreamGradientRevealPlugin, type StreamRevealLifecycle } from "./markdown-reveal";

export type StreamMarkdownProps = Omit<PrimitiveProps<"div">, "children"> & {
  components?: Components;
  content: string;
  live?: boolean;
  remarkPlugins?: ReactMarkdownOptions["remarkPlugins"];
  remarkRehypeOptions?: ReactMarkdownOptions["remarkRehypeOptions"];
};

const defaultRemarkPlugins: NonNullable<ReactMarkdownOptions["remarkPlugins"]> = [remarkGfm];

export const StreamMarkdown = forwardRef<HTMLDivElement, StreamMarkdownProps>(
  function StreamMarkdown(
    { components, content, live = false, remarkPlugins, remarkRehypeOptions, ...props },
    ref,
  ) {
    const revealLifecycleRef = useRef({
      activeScope: null,
      content,
      id: 0,
      settledRevealIds: new Set<string>(),
      startedAtByRevealId: new Map<string, number>(),
    } satisfies StreamRevealLifecycle & { content: string; id: number });
    const revealLifecycle = revealLifecycleRef.current;
    if (revealLifecycle.content !== content) {
      if (!content.startsWith(revealLifecycle.content)) {
        revealLifecycle.id += 1;
        revealLifecycle.activeScope = null;
        revealLifecycle.settledRevealIds.clear();
        revealLifecycle.startedAtByRevealId.clear();
      }
      revealLifecycle.content = content;
    }
    if (!live && revealLifecycle.activeScope !== null) {
      for (const revealId of revealLifecycle.startedAtByRevealId.keys()) {
        revealLifecycle.settledRevealIds.add(revealId);
      }
    }
    const settleReveal = useCallback((revealId: string) => {
      revealLifecycleRef.current.settledRevealIds.add(revealId);
    }, []);

    const blocks = useMemo(
      () =>
        splitStreamMarkdownBlocks(content, {
          singleDocument: remarkPlugins !== undefined,
        }),
      [content, remarkPlugins],
    );
    const streamingComponents = useMemo(
      () => withStreamRevealComponent(components, settleReveal),
      [components, settleReveal],
    );

    return renderPrimitive(
      "div",
      {
        ...props,
        children: blocks.map((block, index) => (
          <StreamMarkdownBlock
            components={streamingComponents}
            content={block.content}
            live={live && index === blocks.length - 1}
            revealLifecycle={revealLifecycle}
            revealScope={`${revealLifecycle.id}:${block.startOffset}`}
            remarkPlugins={remarkPlugins ?? defaultRemarkPlugins}
            remarkRehypeOptions={remarkRehypeOptions}
            key={block.startOffset}
          />
        )),
        "data-anvia-stream-markdown": "",
        "data-live": live ? "" : undefined,
      } as PrimitiveProps<"div">,
      ref,
    );
  },
);

const StreamMarkdownBlock = memo(function StreamMarkdownBlock(props: {
  components: Components;
  content: string;
  live: boolean;
  revealLifecycle: StreamRevealLifecycle;
  revealScope: string;
  remarkPlugins: ReactMarkdownOptions["remarkPlugins"];
  remarkRehypeOptions: ReactMarkdownOptions["remarkRehypeOptions"];
}) {
  const revealPlugin = useMemo(
    () => createStreamGradientRevealPlugin(props.revealScope, props.revealLifecycle),
    [props.revealScope, props.revealLifecycle],
  );
  return (
    <ReactMarkdown
      components={props.components}
      rehypePlugins={props.live ? [revealPlugin] : undefined}
      remarkPlugins={props.remarkPlugins}
      remarkRehypeOptions={props.remarkRehypeOptions}
    >
      {props.content}
    </ReactMarkdown>
  );
});

function withStreamRevealComponent(
  components: Components | undefined,
  onRevealSettled: (revealId: string) => void,
): Components {
  const consumerSpan = components?.span;
  return {
    ...components,
    span(spanProps) {
      const safeProps = componentPropsWithoutKey(spanProps);
      const internalProps = safeProps as typeof safeProps & {
        "data-anvia-stream-duration-ms"?: string | undefined;
        "data-anvia-stream-opacity"?: string | undefined;
        "data-anvia-stream-reveal"?: string | undefined;
        "data-anvia-stream-reveal-id"?: string | undefined;
      };
      if (internalProps["data-anvia-stream-reveal"] !== undefined) {
        return streamRevealSpan(internalProps, onRevealSettled);
      }
      if (consumerSpan !== undefined) {
        return createElement(consumerSpan, safeProps);
      }
      const { node: _node, ...elementProps } = safeProps;
      return <span {...elementProps} />;
    },
  };
}

function componentPropsWithoutKey<T extends object>(props: T): T {
  const result: Record<string, unknown> = {};
  for (const name of Object.keys(props)) {
    if (name !== "key") {
      result[name] = (props as Record<string, unknown>)[name];
    }
  }
  return result as T;
}

function streamRevealSpan(
  props: ComponentPropsWithoutRef<"span"> & {
    node?: unknown;
    "data-anvia-stream-duration-ms"?: string | undefined;
    "data-anvia-stream-opacity"?: string | undefined;
    "data-anvia-stream-reveal"?: string | undefined;
    "data-anvia-stream-reveal-id"?: string | undefined;
  },
  onRevealSettled: (revealId: string) => void,
): ReactNode {
  const {
    children,
    node: _node,
    "data-anvia-stream-duration-ms": durationMs,
    "data-anvia-stream-opacity": opacity,
    "data-anvia-stream-reveal-id": revealId,
    onAnimationEnd,
    ...elementProps
  } = props;
  const parsedOpacity = Number(opacity);
  const parsedDurationMs = Number(durationMs);
  return (
    <span
      {...elementProps}
      data-anvia-stream-reveal-id={revealId}
      key={revealId ?? "stream-reveal"}
      onAnimationEnd={(event) => {
        onAnimationEnd?.(event);
        if (revealId !== undefined) onRevealSettled(revealId);
      }}
      style={
        {
          "--anvia-stream-reveal-opacity": Number.isFinite(parsedOpacity) ? parsedOpacity : 1,
          "--anvia-stream-reveal-duration": `${Number.isFinite(parsedDurationMs) ? parsedDurationMs : 180}ms`,
        } as CSSProperties
      }
    >
      {children}
    </span>
  );
}
