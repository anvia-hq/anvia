import {
  type StreamAnimationMode,
  type StreamSmoothingPreset,
  type UIAttachment,
  type UIMessagePart,
  useSmoothStreamText,
} from "@anvia/react";
import { type ComponentPropsWithoutRef, createElement, forwardRef, type ReactNode } from "react";
import ReactMarkdown, {
  type Components,
  type Options as ReactMarkdownOptions,
} from "react-markdown";
import remarkGfm from "remark-gfm";

import { Attachment } from "../attachment/index";
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
import { MessageEntity } from "./entity";
import { createMessageEntityRemarkPlugin, messageEntityRehypeOptions } from "./markdown-entities";

type MessagePartChildren = ReactNode | ((part: UIMessagePart) => ReactNode);
export type MessagePartsFilter = (part: UIMessagePart) => boolean;
export type MessageToolPart = Extract<UIMessagePart, { type: "tool" }>;
type MessageToolChildren = ReactNode | ((part: MessageToolPart) => ReactNode);
export type MessageToolRenderWhen = "always" | "pending" | "settled";
export type MessageAttachmentPart = Extract<UIMessagePart, { type: "attachment" }>;
type MessageAttachmentChildren = ReactNode | ((attachment: UIAttachment) => ReactNode);

type MessageStreamAnimationProps = {
  animate?: boolean;
  animationMode?: StreamAnimationMode;
  isStreaming?: boolean;
  smoothingPreset?: StreamSmoothingPreset;
  reducedMotion?: boolean;
};

type MessagePartsProps = Omit<PrimitiveProps<"div">, "children"> & {
  children?: MessagePartChildren;
  filter?: MessagePartsFilter;
};

const MessageParts = forwardRef<HTMLDivElement, MessagePartsProps>(function MessageParts(
  { children, filter, ...props },
  ref,
) {
  const { message } = useMessage();
  const parts = filter === undefined ? message.parts : message.parts.filter(filter);

  return renderPrimitive(
    "div",
    {
      ...props,
      children: parts.map((part) => (
        <InternalMessagePartProvider key={part.id} part={part}>
          {typeof children === "function" ? children(part) : (children ?? <MessagePart />)}
        </InternalMessagePartProvider>
      )),
      "data-anvia-message-parts": "",
    } as PrimitiveProps<"div">,
    ref,
  );
});

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
      "data-anvia-part": "",
      "data-part": part.type,
    } as PrimitiveProps<"div">,
    ref,
  );
});

type MessageTextProps = PrimitiveProps<"span"> & MessageStreamAnimationProps;

const MessageText = forwardRef<HTMLSpanElement, MessageTextProps>(function MessageText(props, ref) {
  const { part } = useMessagePart();
  if (part.type !== "text") {
    return null;
  }

  return <MessageTextContent {...props} content={part.text} ref={ref} />;
});

type MessageTextContentProps = MessageTextProps & {
  content: string;
};

const MessageTextContent = forwardRef<HTMLSpanElement, MessageTextContentProps>(
  function MessageTextContent(
    {
      animate = false,
      animationMode = "smooth",
      isStreaming,
      smoothingPreset,
      reducedMotion,
      content,
      ...props
    },
    ref,
  ) {
    const animationEnabled = animate && props.children === undefined;
    const smooth = useSmoothStreamText(content, {
      enabled: animationEnabled,
      mode: animationMode,
      ...(isStreaming === undefined ? {} : { isStreaming }),
      ...(smoothingPreset === undefined ? {} : { preset: smoothingPreset }),
      ...(reducedMotion === undefined ? {} : { reducedMotion }),
    });
    const animationActive =
      animationEnabled &&
      animationMode !== "none" &&
      isStreaming !== false &&
      reducedMotion !== true;

    return renderPrimitive(
      "span",
      {
        ...props,
        children: props.children ?? (animationEnabled ? smooth.text : content),
        "data-anvia-text": "",
        "data-anvia-stream-animation": animationEnabled ? animationMode : undefined,
        "data-streaming": animationActive ? "" : undefined,
      } as PrimitiveProps<"span">,
      ref,
    );
  },
);

type MessageMarkdownProps = Omit<PrimitiveProps<"div">, "children"> &
  MessageStreamAnimationProps & {
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

  return <MessageMarkdownContent {...props} entities={entities} markdown={markdown} ref={ref} />;
});

type MessageMarkdownContentProps = Omit<MessageMarkdownProps, "children"> & {
  entities: ComposerEntity[];
  markdown: string;
};

const MessageMarkdownContent = forwardRef<HTMLDivElement, MessageMarkdownContentProps>(
  function MessageMarkdownContent(
    {
      animate = false,
      animationMode = "smooth",
      isStreaming,
      smoothingPreset,
      reducedMotion,
      components,
      renderEntity,
      remarkPlugins,
      entities,
      markdown,
      ...props
    },
    ref,
  ) {
    const smooth = useSmoothStreamText(markdown, {
      enabled: animate,
      mode: animationMode,
      ...(isStreaming === undefined ? {} : { isStreaming }),
      ...(smoothingPreset === undefined ? {} : { preset: smoothingPreset }),
      ...(reducedMotion === undefined ? {} : { reducedMotion }),
    });
    const animationActive =
      animate && animationMode !== "none" && isStreaming !== false && reducedMotion !== true;
    const renderedMarkdown = animate ? smooth.text : markdown;
    const renderedEntities = validComposerEntities(renderedMarkdown, {
      composer: { entities },
    });

    return renderPrimitive(
      "div",
      {
        ...props,
        children: (
          <ReactMarkdown
            components={markdownComponents(components, renderedEntities, renderEntity)}
            remarkPlugins={[
              createMessageEntityRemarkPlugin(renderedMarkdown, renderedEntities),
              ...(remarkPlugins ?? [remarkGfm]),
            ]}
            remarkRehypeOptions={messageEntityRehypeOptions()}
          >
            {renderedMarkdown}
          </ReactMarkdown>
        ),
        "data-anvia-markdown": "",
        "data-anvia-stream-animation": animate ? animationMode : undefined,
        "data-streaming": animationActive ? "" : undefined,
      } as PrimitiveProps<"div">,
      ref,
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
        "data-anvia-entity-index"?: string | undefined;
      };
      const entityIndexValue = internalProps["data-anvia-entity-index"];
      const entityIndex =
        typeof entityIndexValue === "string" && /^\d+$/.test(entityIndexValue)
          ? Number(entityIndexValue)
          : undefined;
      const entity = entityIndex === undefined ? undefined : entities[entityIndex];
      const consumerProps = { ...internalProps };
      delete consumerProps["data-anvia-entity-index"];

      if (entity !== undefined) {
        if (renderEntity !== undefined) {
          return renderEntity(entity);
        }
        const entityProps = {
          ...consumerProps,
          "data-anvia-message-entity": "",
          "data-entity-id": entity.id,
          "data-trigger-id": entity.triggerId,
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
        children: children ?? (
          <code data-anvia-code="" data-language={language}>
            {code ?? ""}
          </code>
        ),
        "data-anvia-code-block": "",
        "data-language": language,
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
        "data-anvia-reasoning": "",
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
      "data-anvia-tool": "",
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
        "data-anvia-tool-name": "",
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
        "data-anvia-tool-status": "",
        "data-state": part.state,
      } as PrimitiveProps<"span">,
      ref,
    );
  },
);

const MessageToolInput = forwardRef<HTMLPreElement, PrimitiveProps<"pre">>(
  function MessageToolInput(props, ref) {
    const { part } = useMessagePart();
    if (part.type !== "tool" || part.input === undefined) {
      return null;
    }

    return renderPrimitive(
      "pre",
      {
        ...props,
        children: props.children ?? stringifyValue(part.input),
        "data-anvia-tool-input": "",
      } as PrimitiveProps<"pre">,
      ref,
    );
  },
);

const MessageToolOutput = forwardRef<HTMLPreElement, PrimitiveProps<"pre">>(
  function MessageToolOutput(props, ref) {
    const { part } = useMessagePart();
    if (part.type !== "tool" || part.output === undefined) {
      return null;
    }

    return renderPrimitive(
      "pre",
      {
        ...props,
        children: props.children ?? stringifyValue(part.output),
        "data-anvia-tool-output": "",
      } as PrimitiveProps<"pre">,
      ref,
    );
  },
);

const MessageToolError = forwardRef<HTMLDivElement, PrimitiveProps<"div">>(
  function MessageToolError(props, ref) {
    const { part } = useMessagePart();
    if (part.type !== "tool" || part.error === undefined) {
      return null;
    }

    return renderPrimitive(
      "div",
      {
        ...props,
        children: props.children ?? part.error.message,
        "data-anvia-tool-error": "",
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
        : (children ?? <Attachment.Root />);

    return (
      <InternalAttachmentProvider value={{ attachment: part.attachment }}>
        {renderPrimitive(
          "div",
          {
            ...props,
            children: renderedChildren,
            "data-anvia-message-attachment": "",
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
        "data-anvia-data": "",
        "data-name": part.name,
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
        "data-anvia-error": "",
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
  const language = /language-(\S+)/.exec(className ?? "")?.[1];

  return (
    <code
      className={className}
      data-anvia-code=""
      data-anvia-inline-code={language === undefined ? "" : undefined}
      data-language={language}
      {...props}
    >
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
