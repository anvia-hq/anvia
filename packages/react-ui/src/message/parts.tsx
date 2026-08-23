import type { UIAttachment, UIMessagePart } from "@anvia/client";
import {
  type SmoothStreamItemAdapter,
  type StreamSmoothingLifecycle,
  useSmoothStreamItems,
  useSmoothStreamText,
} from "@anvia/react";
import {
  type ComponentPropsWithoutRef,
  createElement,
  forwardRef,
  type ReactNode,
  useMemo,
} from "react";
import type { Components, Options as ReactMarkdownOptions } from "react-markdown";
import remarkGfm from "remark-gfm";

import { AttachmentPrimitive } from "../attachment/index";
import type { ComposerEntity } from "../contexts";
import {
  InternalAttachmentProvider,
  InternalMessagePartProvider,
  useMessage,
  useMessagePart,
  useOptionalMessagePart,
} from "../contexts";
import { entitiesForTextSegment, messageTextLayout, validComposerEntities } from "../entities";
import { stringifyValue } from "../format";
import { type PrimitiveProps, renderPrimitive } from "../primitives";
import { StreamMarkdown } from "../stream";
import { MessageEntity } from "./entity";
import { createMessageEntityRemarkPlugin, messageEntityRehypeOptions } from "./markdown-entities";

type MessagePartChildren = ReactNode | ((part: UIMessagePart) => ReactNode);
export type MessagePartsFilter = (part: UIMessagePart) => boolean;
export type MessageToolPart = Extract<UIMessagePart, { type: "tool" }>;
type MessageToolChildren = ReactNode | ((part: MessageToolPart) => ReactNode);
export type MessageToolRenderWhen = "always" | "pending" | "settled";
export type MessageAttachmentPart = Extract<UIMessagePart, { type: "attachment" }>;
type MessageAttachmentChildren = ReactNode | ((attachment: UIAttachment) => ReactNode);

export type MessageStreamOptions = StreamSmoothingLifecycle;

type MessageStreamProps = {
  stream?: MessageStreamOptions;
};

const messagePartStreamAdapter: SmoothStreamItemAdapter<UIMessagePart> = {
  getKey: (part) => part.id,
  getText: (part) => (part.type === "text" || part.type === "reasoning" ? part.text : undefined),
  withText: (part, text) => {
    if (part.type === "text" || part.type === "reasoning") {
      return part.text === text ? part : { ...part, text };
    }
    return part;
  },
};

type MessagePartsProps = Omit<PrimitiveProps<"div">, "children"> & {
  children?: MessagePartChildren;
  filter?: MessagePartsFilter;
} & MessageStreamProps;

const MessageParts = forwardRef<HTMLDivElement, MessagePartsProps>(function MessageParts(
  { children, filter, stream, ...props },
  ref,
) {
  const { message } = useMessage();
  const parts = filter === undefined ? message.parts : message.parts.filter(filter);
  if (stream !== undefined) {
    return (
      <SmoothedMessageParts {...props} parts={parts} ref={ref} stream={stream}>
        {children}
      </SmoothedMessageParts>
    );
  }

  return renderPrimitive(
    "div",
    {
      ...props,
      children: renderMessagePartNodes(parts, children),
      "data-role": "parts",
    } as PrimitiveProps<"div">,
    ref,
  );
});

type SmoothedMessagePartsProps = Omit<PrimitiveProps<"div">, "children"> & {
  children?: MessagePartChildren;
  parts: readonly UIMessagePart[];
  stream: MessageStreamOptions;
};

const SmoothedMessageParts = forwardRef<HTMLDivElement, SmoothedMessagePartsProps>(
  function SmoothedMessageParts({ children, parts, stream, ...props }, ref) {
    const streamOptions = {
      adapter: messagePartStreamAdapter,
      isStreaming: stream.isStreaming,
      resetKey: stream.resetKey,
    };
    if (stream.flushImmediately !== undefined) {
      Object.assign(streamOptions, { flushImmediately: stream.flushImmediately });
    }
    const smooth = useSmoothStreamItems(parts, streamOptions);

    return renderPrimitive(
      "div",
      {
        ...props,
        children: renderMessagePartNodes(smooth.items, children, smooth.liveItemKey),
        "data-role": "parts",
        "data-state": smooth.isDraining ? "draining" : stream.isStreaming ? "streaming" : "idle",
      } as PrimitiveProps<"div">,
      ref,
    );
  },
);

function renderMessagePartNodes(
  parts: readonly UIMessagePart[],
  children: MessagePartChildren | undefined,
  liveItemKey?: string | null,
): ReactNode[] {
  return parts.map((part) => (
    <InternalMessagePartProvider
      isLive={liveItemKey === part.id}
      key={part.id}
      part={part}
      streamControlled={liveItemKey !== undefined}
    >
      {typeof children === "function" ? children(part) : (children ?? <MessagePart />)}
    </InternalMessagePartProvider>
  ));
}

type MessagePartProps = Omit<PrimitiveProps<"div">, "children"> & {
  children?: MessagePartChildren;
};

const MessagePart = forwardRef<HTMLDivElement, MessagePartProps>(function MessagePart(
  { children, ...props },
  ref,
) {
  const { part } = useMessagePart();
  const renderedChildren =
    typeof children === "function" ? children(part) : (children ?? defaultPart(part));

  return renderPrimitive(
    "div",
    {
      ...props,
      children: renderedChildren,
      "data-role": part.type,
    } as PrimitiveProps<"div">,
    ref,
  );
});

type MessageTextProps = PrimitiveProps<"span"> & MessageStreamProps;

const MessageText = forwardRef<HTMLSpanElement, MessageTextProps>(function MessageText(props, ref) {
  const { part, streamControlled } = useMessagePart();
  if (part.type !== "text") {
    return null;
  }

  return (
    <MessageTextContent
      {...props}
      content={part.text}
      partId={part.id}
      ref={ref}
      streamControlled={streamControlled}
    />
  );
});

type MessageTextContentProps = MessageTextProps & {
  content: string;
  partId: string;
  streamControlled: boolean;
};

const MessageTextContent = forwardRef<HTMLSpanElement, MessageTextContentProps>(
  function MessageTextContent({ content, partId, stream, streamControlled, ...props }, ref) {
    const ownsStream = stream !== undefined && !streamControlled && props.children === undefined;
    const streamOptions = {
      isStreaming: ownsStream ? stream.isStreaming : false,
      resetKey: ownsStream ? stream.resetKey : partId,
    };
    if (ownsStream && stream.flushImmediately !== undefined) {
      Object.assign(streamOptions, { flushImmediately: stream.flushImmediately });
    }
    const smooth = useSmoothStreamText(content, streamOptions);

    return renderPrimitive(
      "span",
      {
        ...props,
        children: props.children ?? (ownsStream ? smooth.text : content),
        "data-role": "text",
        "data-state": ownsStream
          ? smooth.isDraining
            ? "draining"
            : stream.isStreaming
              ? "streaming"
              : "idle"
          : undefined,
      } as PrimitiveProps<"span">,
      ref,
    );
  },
);

type MessageMarkdownProps = Omit<PrimitiveProps<"div">, "children"> &
  MessageStreamProps & {
    children?: string;
    components?: Components;
    renderEntity?: ((entity: ComposerEntity) => ReactNode) | undefined;
    remarkPlugins?: ReactMarkdownOptions["remarkPlugins"];
  };

const MessageMarkdown = forwardRef<HTMLDivElement, MessageMarkdownProps>(function MessageMarkdown(
  { children, ...props },
  ref,
) {
  const { message } = useMessage();
  const partContext = useOptionalMessagePart();
  const part = partContext?.part;
  if (part !== undefined && part.type !== "text") {
    return null;
  }

  const layout = messageTextLayout(message.parts);
  const markdown = children ?? (part?.type === "text" ? part.text : layout.text);
  const expectedMarkdown = part?.type === "text" ? part.text : layout.text;
  const validEntities =
    children === undefined || children === expectedMarkdown
      ? validComposerEntities(layout.text, message.metadata)
      : [];
  const segment =
    part?.type === "text"
      ? layout.segments.find((candidate) => candidate.part.id === part.id)
      : undefined;
  const entities =
    segment === undefined ? validEntities : entitiesForTextSegment(validEntities, segment);
  const lastPart = message.parts.at(-1);
  const liveEligible = part?.type === "text" ? lastPart?.id === part.id : lastPart?.type === "text";

  return (
    <MessageMarkdownContent
      {...props}
      entities={entities}
      liveEligible={liveEligible}
      markdown={markdown}
      ref={ref}
      resetKey={message.id}
      streamControlled={partContext?.streamControlled ?? false}
      streamLive={partContext?.isLive ?? false}
    />
  );
});

type MessageMarkdownContentProps = Omit<MessageMarkdownProps, "children"> & {
  entities: ComposerEntity[];
  liveEligible: boolean;
  markdown: string;
  resetKey: string;
  streamControlled: boolean;
  streamLive: boolean;
};

const MessageMarkdownContent = forwardRef<HTMLDivElement, MessageMarkdownContentProps>(
  function MessageMarkdownContent(
    {
      components,
      renderEntity,
      remarkPlugins,
      entities,
      liveEligible,
      markdown,
      resetKey,
      stream,
      streamControlled,
      streamLive,
      ...props
    },
    ref,
  ) {
    const ownsStream = stream !== undefined && !streamControlled;
    const streamOptions = {
      isStreaming: ownsStream ? stream.isStreaming : false,
      resetKey: ownsStream ? stream.resetKey : resetKey,
    };
    if (ownsStream && stream.flushImmediately !== undefined) {
      Object.assign(streamOptions, { flushImmediately: stream.flushImmediately });
    }
    const smooth = useSmoothStreamText(markdown, streamOptions);
    const renderedMarkdown = ownsStream ? smooth.text : markdown;
    const renderedEntities = useMemo(
      () =>
        entities.length === 0
          ? entities
          : validComposerEntities(renderedMarkdown, {
              composer: { entities },
            }),
      [entities, renderedMarkdown],
    );
    const renderedComponents = useMemo(
      () => markdownComponents(components, renderedEntities, renderEntity),
      [components, renderEntity, renderedEntities],
    );
    const renderedRemarkPlugins = useMemo(
      () =>
        renderedEntities.length === 0
          ? remarkPlugins
          : [
              createMessageEntityRemarkPlugin(renderedMarkdown, renderedEntities),
              ...(remarkPlugins ?? [remarkGfm]),
            ],
      [remarkPlugins, renderedEntities, renderedMarkdown],
    );
    const live = streamControlled
      ? streamLive
      : ownsStream && liveEligible && (stream.isStreaming || smooth.isDraining);

    return (
      <StreamMarkdown
        {...props}
        components={renderedComponents}
        content={renderedMarkdown}
        data-state={
          ownsStream && smooth.isDraining
            ? "draining"
            : ownsStream && stream.isStreaming
              ? "streaming"
              : "idle"
        }
        live={live}
        ref={ref}
        remarkPlugins={renderedRemarkPlugins}
        remarkRehypeOptions={
          renderedEntities.length === 0 ? undefined : messageEntityRehypeOptions()
        }
      />
    );
  },
);

function markdownComponents(
  components: Components | undefined,
  entities: ComposerEntity[],
  renderEntity: ((entity: ComposerEntity) => ReactNode) | undefined,
): Components {
  const consumerSpan = components?.span;
  return {
    code: defaultCodeComponent,
    pre: defaultPreComponent,
    ...components,
    span(spanProps) {
      const internalProps = spanProps as typeof spanProps & {
        "data-entity-index"?: string | undefined;
      };
      const entityIndexValue = internalProps["data-entity-index"];
      const entityIndex =
        typeof entityIndexValue === "string" && /^\d+$/.test(entityIndexValue)
          ? Number(entityIndexValue)
          : undefined;
      const entity = entityIndex === undefined ? undefined : entities[entityIndex];
      const consumerProps = { ...internalProps };
      delete consumerProps["data-entity-index"];

      if (entity !== undefined) {
        if (renderEntity !== undefined) {
          return renderEntity(entity);
        }
        const entityProps = {
          ...consumerProps,
          "data-role": "entity",
        };
        if (consumerSpan !== undefined) {
          return createElement(consumerSpan, entityProps);
        }
        const { node: _node, ...elementProps } = entityProps;
        return <MessageEntity {...elementProps} entity={entity} />;
      }

      if (consumerSpan !== undefined) {
        return createElement(consumerSpan, consumerProps);
      }
      const { node: _node, ...elementProps } = consumerProps;
      return <span {...elementProps} />;
    },
  };
}

type MessageCodeBlockProps = Omit<PrimitiveProps<"pre">, "children"> & {
  children?: ReactNode;
  code?: string;
  language?: string;
};

const MessageCodeBlock = forwardRef<HTMLPreElement, MessageCodeBlockProps>(
  function MessageCodeBlock({ children, code, language, ...props }, ref) {
    return renderPrimitive(
      "pre",
      {
        ...props,
        "data-role": "code-block",
        children: children ?? (
          <code className={language === undefined ? undefined : `language-${language}`}>
            {code ?? ""}
          </code>
        ),
      } as PrimitiveProps<"pre">,
      ref,
    );
  },
);

const MessageReasoning = forwardRef<HTMLDetailsElement, PrimitiveProps<"details">>(
  function MessageReasoning(props, ref) {
    const { part } = useMessagePart();
    if (part.type !== "reasoning") {
      return null;
    }

    return renderPrimitive(
      "details",
      {
        ...props,
        children: props.children ?? (
          <>
            <summary>Reasoning</summary>
            <pre>{part.text}</pre>
          </>
        ),
      } as PrimitiveProps<"details">,
      ref,
    );
  },
);

type MessageToolProps = Omit<PrimitiveProps<"div">, "children"> & {
  children?: MessageToolChildren;
  renderWhen?: MessageToolRenderWhen;
};

const MessageTool = forwardRef<HTMLDivElement, MessageToolProps>(function MessageTool(
  { children, renderWhen = "always", ...props },
  ref,
) {
  const { part } = useMessagePart();
  if (part.type !== "tool" || !shouldRenderTool(part, renderWhen)) {
    return null;
  }
  const renderedChildren =
    typeof children === "function" ? children(part) : (children ?? defaultToolContent());

  return renderPrimitive(
    "div",
    {
      ...props,
      children: renderedChildren,
      "data-role": "tool",
      "data-state": part.state,
    } as PrimitiveProps<"div">,
    ref,
  );
});

const MessageToolName = forwardRef<HTMLSpanElement, PrimitiveProps<"span">>(
  function MessageToolName(props, ref) {
    const { part } = useMessagePart();
    if (part.type !== "tool") {
      return null;
    }

    return renderPrimitive(
      "span",
      {
        ...props,
        children: props.children ?? part.toolName,
      } as PrimitiveProps<"span">,
      ref,
    );
  },
);

const MessageToolStatus = forwardRef<HTMLSpanElement, PrimitiveProps<"span">>(
  function MessageToolStatus(props, ref) {
    const { part } = useMessagePart();
    if (part.type !== "tool") {
      return null;
    }

    return renderPrimitive(
      "span",
      {
        ...props,
        children: props.children ?? toolStateLabel(part.state),
        "data-state": part.state,
      } as PrimitiveProps<"span">,
      ref,
    );
  },
);

const MessageToolInput = forwardRef<HTMLPreElement, PrimitiveProps<"pre">>(
  function MessageToolInput(props, ref) {
    const { part } = useMessagePart();
    if (part.type !== "tool") {
      return null;
    }

    return renderPrimitive(
      "pre",
      {
        ...props,
        children: props.children ?? stringifyValue(part.input),
      } as PrimitiveProps<"pre">,
      ref,
    );
  },
);

const MessageToolOutput = forwardRef<HTMLPreElement, PrimitiveProps<"pre">>(
  function MessageToolOutput(props, ref) {
    const { part } = useMessagePart();
    if (part.type !== "tool" || part.state !== "output-available") {
      return null;
    }

    return renderPrimitive(
      "pre",
      {
        ...props,
        children: props.children ?? stringifyValue(part.output),
      } as PrimitiveProps<"pre">,
      ref,
    );
  },
);

const MessageToolError = forwardRef<HTMLDivElement, PrimitiveProps<"div">>(
  function MessageToolError(props, ref) {
    const { part } = useMessagePart();
    if (part.type !== "tool" || part.state !== "error") {
      return null;
    }

    return renderPrimitive(
      "div",
      {
        ...props,
        children: props.children ?? part.error.message,
        role: props.role ?? "alert",
      } as PrimitiveProps<"div">,
      ref,
    );
  },
);

type MessageAttachmentProps = Omit<PrimitiveProps<"div">, "children"> & {
  children?: MessageAttachmentChildren;
};

const MessageAttachment = forwardRef<HTMLDivElement, MessageAttachmentProps>(
  function MessageAttachment({ children, ...props }, ref) {
    const { part } = useMessagePart();
    if (part.type !== "attachment") {
      return null;
    }
    const renderedChildren =
      typeof children === "function"
        ? children(part.attachment)
        : (children ?? <AttachmentPrimitive.Root />);

    return (
      <InternalAttachmentProvider value={{ attachment: part.attachment }}>
        {renderPrimitive(
          "div",
          {
            ...props,
            children: renderedChildren,
          } as PrimitiveProps<"div">,
          ref,
        )}
      </InternalAttachmentProvider>
    );
  },
);

const MessageData = forwardRef<HTMLPreElement, PrimitiveProps<"pre">>(
  function MessageData(props, ref) {
    const { part } = useMessagePart();
    if (part.type !== "data") {
      return null;
    }

    return renderPrimitive(
      "pre",
      {
        ...props,
        children: props.children ?? stringifyValue(part.data),
      } as PrimitiveProps<"pre">,
      ref,
    );
  },
);

const MessageError = forwardRef<HTMLDivElement, PrimitiveProps<"div">>(
  function MessageError(props, ref) {
    const { part } = useMessagePart();
    if (part.type !== "error") {
      return null;
    }

    return renderPrimitive(
      "div",
      {
        ...props,
        children: props.children ?? part.error.message,
        role: props.role ?? "alert",
      } as PrimitiveProps<"div">,
      ref,
    );
  },
);

function defaultPart(part: UIMessagePart): ReactNode {
  if (part.type === "text") {
    return <MessageText />;
  }
  if (part.type === "reasoning") {
    return <MessageReasoning />;
  }
  if (part.type === "tool") {
    return <MessageTool />;
  }
  if (part.type === "attachment") {
    return <MessageAttachment />;
  }
  if (part.type === "data") {
    return <MessageData />;
  }
  return <MessageError />;
}

function defaultToolContent(): ReactNode {
  return (
    <>
      <MessageToolName />
      <MessageToolStatus />
      <MessageToolInput />
      <MessageToolOutput />
      <MessageToolError />
    </>
  );
}

function defaultCodeComponent({
  children,
  className,
  node: _node,
  ...props
}: ComponentPropsWithoutRef<"code"> & { node?: unknown }): ReactNode {
  return (
    <code className={className} {...props}>
      {children}
    </code>
  );
}

function defaultPreComponent({
  children,
  node: _node,
  ...props
}: ComponentPropsWithoutRef<"pre"> & { node?: unknown }): ReactNode {
  return <MessageCodeBlock {...props}>{children}</MessageCodeBlock>;
}

function shouldRenderTool(part: MessageToolPart, renderWhen: MessageToolRenderWhen): boolean {
  if (renderWhen === "always") {
    return true;
  }
  if (renderWhen === "pending") {
    return part.state === "input-streaming" || part.state === "input-available";
  }
  return part.state === "output-available" || part.state === "error";
}

function toolStateLabel(state: MessageToolPart["state"]): string {
  if (state === "output-available") {
    return "Done";
  }
  if (state === "error") {
    return "Error";
  }
  return "Running";
}

export {
  MessageAttachment,
  MessageCodeBlock,
  MessageData,
  MessageError,
  MessageMarkdown,
  MessagePart,
  MessageParts,
  MessageReasoning,
  MessageText,
  MessageTool,
  MessageToolError,
  MessageToolInput,
  MessageToolName,
  MessageToolOutput,
  MessageToolStatus,
};
