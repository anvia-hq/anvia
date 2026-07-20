import {
  type ComponentPropsWithoutRef,
  createElement,
  forwardRef,
  memo,
  type ReactNode,
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
import { createStreamGradientRevealPlugin } from "./markdown-reveal";

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
    const previousContentRef = useRef(content);
    const frameIdRef = useRef(0);
    if (previousContentRef.current !== content) {
      previousContentRef.current = content;
      frameIdRef.current += 1;
    }

    const blocks = useMemo(
      () =>
        splitStreamMarkdownBlocks(content, {
          singleDocument: remarkPlugins !== undefined,
        }),
      [content, remarkPlugins],
    );
    const streamingComponents = useMemo(() => withStreamRevealComponent(components), [components]);

    return renderPrimitive(
      "div",
      {
        ...props,
        children: blocks.map((block, index) => (
          <StreamMarkdownBlock
            components={streamingComponents}
            content={block.content}
            frameId={live && index === blocks.length - 1 ? frameIdRef.current : 0}
            live={live && index === blocks.length - 1}
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
  frameId: number;
  live: boolean;
  remarkPlugins: ReactMarkdownOptions["remarkPlugins"];
  remarkRehypeOptions: ReactMarkdownOptions["remarkRehypeOptions"];
}) {
  const revealPlugin = useMemo(
    () => createStreamGradientRevealPlugin(props.frameId),
    [props.frameId],
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

function withStreamRevealComponent(components: Components | undefined): Components {
  const consumerSpan = components?.span;
  return {
    ...components,
    span(spanProps) {
      const safeProps = componentPropsWithoutKey(spanProps);
      const internalProps = safeProps as typeof safeProps & {
        "data-anvia-stream-frame-id"?: string | undefined;
        "data-anvia-stream-opacity"?: string | undefined;
        "data-anvia-stream-reveal"?: string | undefined;
      };
      if (internalProps["data-anvia-stream-reveal"] !== undefined) {
        return streamRevealSpan(internalProps);
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
    "data-anvia-stream-frame-id"?: string | undefined;
    "data-anvia-stream-opacity"?: string | undefined;
    "data-anvia-stream-reveal"?: string | undefined;
  },
): ReactNode {
  const {
    children,
    node: _node,
    "data-anvia-stream-frame-id": frameId,
    "data-anvia-stream-opacity": opacity,
    ...elementProps
  } = props;
  const parsedOpacity = Number(opacity);
  return (
    <span
      {...elementProps}
      data-anvia-stream-frame-id={frameId}
      key={frameId ?? "stream-frame"}
      style={{ opacity: Number.isFinite(parsedOpacity) ? parsedOpacity : 1 }}
    >
      {children}
    </span>
  );
}
