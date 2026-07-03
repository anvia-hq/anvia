import type { UIAttachment, UIMessagePart } from "@anvia/react";
import { type ComponentPropsWithoutRef, forwardRef, type ReactNode } from "react";
import ReactMarkdown, {
  type Components,
  type Options as ReactMarkdownOptions,
} from "react-markdown";
import remarkGfm from "remark-gfm";

import { Attachment } from "../attachment/index";
import {
  InternalAttachmentProvider,
  InternalMessagePartProvider,
  useMessage,
  useMessagePart,
  useOptionalMessagePart,
} from "../contexts";
import { stringifyValue } from "../format";
import { type PrimitiveProps, renderPrimitive } from "../primitives";

type MessagePartChildren = ReactNode | ((part: UIMessagePart) => ReactNode);
export type MessagePartsFilter = (part: UIMessagePart) => boolean;
export type MessageToolPart = Extract<UIMessagePart, { type: "tool" }>;
type MessageToolChildren = ReactNode | ((part: MessageToolPart) => ReactNode);
export type MessageToolRenderWhen = "always" | "pending" | "settled";
export type MessageAttachmentPart = Extract<UIMessagePart, { type: "attachment" }>;
type MessageAttachmentChildren = ReactNode | ((attachment: UIAttachment) => ReactNode);

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

const MessageText = forwardRef<HTMLSpanElement, PrimitiveProps<"span">>(
  function MessageText(props, ref) {
    const { part } = useMessagePart();
    if (part.type !== "text") {
      return null;
    }

    return renderPrimitive(
      "span",
      {
        ...props,
        children: props.children ?? part.text,
        "data-anvia-text": "",
      } as PrimitiveProps<"span">,
      ref,
    );
  },
);

type MessageMarkdownProps = Omit<PrimitiveProps<"div">, "children"> & {
  children?: string;
  components?: Components;
  remarkPlugins?: ReactMarkdownOptions["remarkPlugins"];
};

const MessageMarkdown = forwardRef<HTMLDivElement, MessageMarkdownProps>(function MessageMarkdown(
  { children, components, remarkPlugins, ...props },
  ref,
) {
  const { message } = useMessage();
  const partContext = useOptionalMessagePart();
  const part = partContext?.part;
  if (part !== undefined && part.type !== "text") {
    return null;
  }

  const markdown =
    children ??
    (part?.type === "text"
      ? part.text
      : message.parts.flatMap((item) => (item.type === "text" ? [item.text] : [])).join("\n\n"));

  return renderPrimitive(
    "div",
    {
      ...props,
      children: (
        <ReactMarkdown
          components={{ code: defaultCodeComponent, pre: defaultPreComponent, ...components }}
          remarkPlugins={remarkPlugins ?? [remarkGfm]}
        >
          {markdown}
        </ReactMarkdown>
      ),
      "data-anvia-markdown": "",
    } as PrimitiveProps<"div">,
    ref,
  );
});

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
