import type { CreateUIAttachment, UIAttachment } from "@anvia/react";
import {
  type ChangeEvent,
  type DragEvent,
  type FormEvent,
  forwardRef,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Attachment } from "../attachment/index";
import {
  type ChatController,
  type ComposerAttachmentInput as ComposerAttachmentInputValue,
  type ComposerAttachmentsUpdate,
  type ComposerContextValue,
  type ComposerQuote,
  InternalAttachmentProvider,
  InternalComposerProvider,
  useChatContext,
  useComposer,
} from "../contexts";
import { composeRefs, type PrimitiveProps, renderPrimitive } from "../primitives";

type ComposerRootProps = PrimitiveProps<"form"> & {
  attachments?: UIAttachment[];
  defaultAttachments?: UIAttachment[];
  defaultInput?: string;
  defaultQuote?: ComposerQuote | undefined;
  input?: string;
  onAttachmentsChange?: (attachments: UIAttachment[]) => void;
  onInputChange?: (input: string) => void;
  onQuoteChange?: (quote: ComposerQuote | undefined) => void;
  quote?: ComposerQuote | undefined;
  submitMessage?: ComposerSubmitMessage;
};

export type ComposerSubmitMessageArgs<TEvent = unknown> = {
  input: string;
  attachments: UIAttachment[];
  chat: ChatController<TEvent>;
  quote?: ComposerQuote | undefined;
  clear(): void;
};

export type ComposerSubmitMessage<TEvent = unknown> = (
  args: ComposerSubmitMessageArgs<TEvent>,
) => Promise<void> | void;

const ComposerRoot = forwardRef<HTMLFormElement, ComposerRootProps>(function ComposerRoot(
  {
    attachments: attachmentsProp,
    defaultAttachments,
    defaultInput = "",
    defaultQuote,
    input: inputProp,
    onAttachmentsChange,
    onInputChange,
    onQuoteChange,
    quote: quoteProp,
    submitMessage,
    onSubmit,
    ...props
  },
  ref,
) {
  const chat = useChatContext();
  const [uncontrolledInput, setUncontrolledInput] = useState(defaultInput);
  const [uncontrolledAttachments, setUncontrolledAttachments] = useState<UIAttachment[]>(() => [
    ...(defaultAttachments ?? []),
  ]);
  const [uncontrolledQuote, setUncontrolledQuote] = useState<ComposerQuote | undefined>(
    defaultQuote,
  );
  const input = inputProp ?? uncontrolledInput;
  const attachments = attachmentsProp ?? uncontrolledAttachments;
  const rawQuote = quoteProp ?? uncontrolledQuote;
  const rawQuoteMessageId = rawQuote?.messageId;
  const rawQuoteText = rawQuote?.text;
  const quote = useMemo(
    () =>
      rawQuoteMessageId === undefined || rawQuoteText === undefined
        ? undefined
        : { messageId: rawQuoteMessageId, text: rawQuoteText },
    [rawQuoteMessageId, rawQuoteText],
  );
  const attachmentsRef = useRef(attachments);
  attachmentsRef.current = attachments;
  const inputControlled = inputProp !== undefined;
  const attachmentsControlled = attachmentsProp !== undefined;
  const quoteControlled = quoteProp !== undefined;
  const hasMessageContent =
    input.trim().length > 0 || attachments.length > 0 || quote !== undefined;
  const canSubmit = hasMessageContent && chat.status !== "streaming";
  const canStop = chat.status === "streaming";

  const setInput = useCallback(
    (nextInput: string) => {
      if (!inputControlled) {
        setUncontrolledInput(nextInput);
      }
      onInputChange?.(nextInput);
    },
    [inputControlled, onInputChange],
  );

  const setAttachments = useCallback(
    (update: ComposerAttachmentsUpdate) => {
      const nextAttachments =
        typeof update === "function" ? update(attachmentsRef.current) : update;
      attachmentsRef.current = nextAttachments;
      if (!attachmentsControlled) {
        setUncontrolledAttachments(nextAttachments);
      }
      onAttachmentsChange?.(nextAttachments);
    },
    [attachmentsControlled, onAttachmentsChange],
  );

  const setQuote = useCallback(
    (nextQuote: ComposerQuote | undefined) => {
      const normalizedQuote = normalizeQuote(nextQuote);
      if (!quoteControlled) {
        setUncontrolledQuote(normalizedQuote);
      }
      onQuoteChange?.(normalizedQuote);
    },
    [onQuoteChange, quoteControlled],
  );

  const addAttachment = useCallback(
    async (attachment: ComposerAttachmentInputValue) => {
      const normalized = isFileAttachmentInput(attachment)
        ? await attachmentFromFile(attachment)
        : createAttachment(attachment);
      setAttachments((current) => [...current, normalized]);
    },
    [setAttachments],
  );

  const removeAttachment = useCallback(
    (id: string) => {
      setAttachments((current) => current.filter((attachment) => attachment.id !== id));
    },
    [setAttachments],
  );

  const clearAttachments = useCallback(() => {
    setAttachments([]);
  }, [setAttachments]);

  const clearQuote = useCallback(() => {
    setQuote(undefined);
  }, [setQuote]);

  const clear = useCallback(() => {
    setInput("");
    setAttachments([]);
    clearQuote();
  }, [clearQuote, setAttachments, setInput]);

  const submit = useCallback(async () => {
    const prompt = input;
    if (
      (prompt.trim().length === 0 && attachments.length === 0 && quote === undefined) ||
      chat.status === "streaming"
    ) {
      return;
    }
    if (submitMessage !== undefined) {
      await submitMessage({
        input: prompt,
        attachments,
        chat,
        quote,
        clear,
      });
      return;
    }
    const submittedText = quote === undefined ? prompt : promptWithQuote(prompt, quote);
    if (attachments.length === 0) {
      if (quote === undefined) {
        await chat.sendMessage(prompt);
      } else {
        await chat.sendMessage({
          text: submittedText,
          metadata: { quote },
        });
      }
    } else {
      await chat.sendMessage({
        text: submittedText,
        attachments,
        ...(quote === undefined ? {} : { metadata: { quote } }),
      });
    }
    clear();
  }, [attachments, chat, clear, input, quote, submitMessage]);

  const value = useMemo<ComposerContextValue>(
    () => ({
      input,
      setInput,
      attachments,
      setAttachments,
      addAttachment,
      removeAttachment,
      clearAttachments,
      quote,
      setQuote,
      clearQuote,
      submit,
      stop: chat.stop,
      status: chat.status,
      canSubmit,
      canStop,
    }),
    [
      addAttachment,
      attachments,
      canStop,
      canSubmit,
      chat.status,
      chat.stop,
      clearAttachments,
      clearQuote,
      input,
      quote,
      removeAttachment,
      setAttachments,
      setInput,
      setQuote,
      submit,
    ],
  );

  const handleSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      (onSubmit as ((event: FormEvent<HTMLFormElement>) => void) | undefined)?.(event);
      if (event.defaultPrevented) {
        return;
      }
      event.preventDefault();
      void submit();
    },
    [onSubmit, submit],
  );

  return (
    <InternalComposerProvider value={value}>
      {renderPrimitive(
        "form",
        {
          ...props,
          onSubmit: handleSubmit,
          "data-anvia-composer": "",
          "data-state": chat.status,
        } as PrimitiveProps<"form">,
        ref,
      )}
    </InternalComposerProvider>
  );
});

type ComposerQuoteProps = Omit<PrimitiveProps<"blockquote">, "children"> & {
  children?: ReactNode | ((quote: ComposerQuote) => ReactNode);
};

const ComposerQuotePreview = forwardRef<HTMLQuoteElement, ComposerQuoteProps>(
  function ComposerQuotePreview({ children, ...props }, ref) {
    const composer = useComposer();
    const quote = composer.quote;
    if (quote === undefined) {
      return null;
    }
    const renderedChildren =
      typeof children === "function" ? children(quote) : (children ?? quote.text);

    return renderPrimitive(
      "blockquote",
      {
        ...props,
        children: renderedChildren,
        "data-anvia-composer-quote": "",
        "data-message-id": quote.messageId,
      } as PrimitiveProps<"blockquote">,
      ref,
    );
  },
);

const ComposerClearQuote = forwardRef<HTMLButtonElement, PrimitiveProps<"button">>(
  function ComposerClearQuote({ onClick, ...props }, ref) {
    const composer = useComposer();
    const disabled = props.disabled ?? composer.quote === undefined;

    const handleClick = useCallback(
      (event: MouseEvent<HTMLButtonElement>) => {
        onClick?.(event);
        if (event.defaultPrevented || disabled) {
          return;
        }
        composer.clearQuote();
      },
      [composer, disabled, onClick],
    );

    return renderPrimitive(
      "button",
      {
        ...props,
        children: props.children ?? "Clear quote",
        disabled,
        onClick: handleClick,
        type: props.type ?? "button",
        "data-anvia-clear-quote": "",
        "data-state": disabled ? "disabled" : "enabled",
      } as PrimitiveProps<"button">,
      ref,
    );
  },
);

type ComposerInputProps = PrimitiveProps<"textarea"> & {
  autoResize?: boolean;
  maxRows?: number;
  minRows?: number;
};

const ComposerInput = forwardRef<HTMLTextAreaElement, ComposerInputProps>(function ComposerInput(
  {
    autoResize = true,
    maxRows: maxRowsProp,
    minRows: minRowsProp,
    onChange,
    onKeyDown,
    rows,
    ...props
  },
  ref,
) {
  const composer = useComposer();
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const wasAutoResizeRef = useRef(autoResize);
  const composedInputRef = useMemo(() => composeRefs(inputRef, ref), [ref]);
  const minRows = normalizeRows(minRowsProp ?? rows ?? 1, 1);
  const maxRows = normalizeRows(maxRowsProp ?? 6, minRows);

  useEffect(() => {
    const wasAutoResize = wasAutoResizeRef.current;
    wasAutoResizeRef.current = autoResize;
    if (!autoResize) {
      if (wasAutoResize) {
        resetComposerInputSize(inputRef.current);
      }
      return;
    }
    resizeComposerInput(inputRef.current, { maxRows, minRows });
  });

  const handleChange = useCallback(
    (event: ChangeEvent<HTMLTextAreaElement>) => {
      onChange?.(event);
      if (!event.defaultPrevented) {
        composer.setInput(event.currentTarget.value);
        if (autoResize) {
          resizeComposerInput(event.currentTarget, { maxRows, minRows });
        }
      }
    },
    [autoResize, composer, maxRows, minRows, onChange],
  );

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      onKeyDown?.(event);
      if (
        event.defaultPrevented ||
        event.key !== "Enter" ||
        event.shiftKey ||
        event.nativeEvent.isComposing
      ) {
        return;
      }
      event.preventDefault();
      void composer.submit();
    },
    [composer, onKeyDown],
  );

  return renderPrimitive(
    "textarea",
    {
      ...props,
      "aria-label": props["aria-label"] ?? "Message",
      disabled: props.disabled ?? composer.status === "streaming",
      onChange: handleChange,
      onKeyDown: handleKeyDown,
      rows: autoResize ? minRows : rows,
      value: composer.input,
      "data-anvia-composer-input": "",
    } as PrimitiveProps<"textarea">,
    composedInputRef,
  );
});

type ComposerInputResizeOptions = {
  maxRows: number;
  minRows: number;
};

function resizeComposerInput(
  input: HTMLTextAreaElement | null,
  { maxRows, minRows }: ComposerInputResizeOptions,
): void {
  if (input === null) {
    return;
  }

  const style = getComputedStyle(input);
  const lineHeight = lineHeightFromStyle(style);
  const paddingHeight = pixelValue(style.paddingTop) + pixelValue(style.paddingBottom);
  const borderHeight = pixelValue(style.borderTopWidth) + pixelValue(style.borderBottomWidth);
  const minContentHeight = lineHeight * minRows;
  const maxContentHeight = Math.max(minContentHeight, lineHeight * maxRows);

  input.style.height = "auto";
  const scrollContentHeight = Math.max(input.scrollHeight - paddingHeight, 0);
  const contentHeight = clamp(scrollContentHeight, minContentHeight, maxContentHeight);
  const nextHeight =
    style.boxSizing === "border-box" ? contentHeight + paddingHeight + borderHeight : contentHeight;

  input.style.height = `${Math.ceil(nextHeight)}px`;
  input.style.overflowY = scrollContentHeight > maxContentHeight ? "auto" : "hidden";
}

function resetComposerInputSize(input: HTMLTextAreaElement | null): void {
  if (input === null) {
    return;
  }
  input.style.height = "";
  input.style.overflowY = "";
}

function normalizeRows(value: number, min: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.max(min, Math.floor(value));
}

function lineHeightFromStyle(style: CSSStyleDeclaration): number {
  return pixelValue(style.lineHeight) || (pixelValue(style.fontSize) || 16) * 1.2;
}

function pixelValue(value: string): number {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function promptWithQuote(prompt: string, quote: ComposerQuote): string {
  const quotedText = quote.text
    .split(/\r?\n/)
    .map((line) => `> ${line}`)
    .join("\n");
  if (prompt.trim().length === 0) {
    return quotedText;
  }
  return `${quotedText}\n\n${prompt}`;
}

function normalizeQuote(quote: ComposerQuote | undefined): ComposerQuote | undefined {
  if (quote === undefined) {
    return undefined;
  }
  return {
    text: quote.text,
    messageId: quote.messageId,
  };
}

const ComposerSubmit = forwardRef<HTMLButtonElement, PrimitiveProps<"button">>(
  function ComposerSubmit(props, ref) {
    const composer = useComposer();
    const disabled = props.disabled ?? !composer.canSubmit;

    return renderPrimitive(
      "button",
      {
        ...props,
        children: props.children ?? "Send",
        disabled,
        type: props.type ?? "submit",
        "data-anvia-submit": "",
        "data-state": disabled ? "disabled" : "enabled",
      } as PrimitiveProps<"button">,
      ref,
    );
  },
);

const ComposerStop = forwardRef<HTMLButtonElement, PrimitiveProps<"button">>(function ComposerStop(
  { onClick, ...props },
  ref,
) {
  const composer = useComposer();
  const disabled = props.disabled ?? !composer.canStop;

  const handleClick = useCallback(
    (event: MouseEvent<HTMLButtonElement>) => {
      onClick?.(event);
      if (event.defaultPrevented || disabled) {
        return;
      }
      composer.stop();
    },
    [composer, disabled, onClick],
  );

  return renderPrimitive(
    "button",
    {
      ...props,
      children: props.children ?? "Stop",
      disabled,
      onClick: handleClick,
      type: props.type ?? "button",
      "data-anvia-stop": "",
      "data-state": disabled ? "disabled" : "enabled",
    } as PrimitiveProps<"button">,
    ref,
  );
});

type ComposerAttachmentsChildren = ReactNode | ((attachment: UIAttachment) => ReactNode);

type ComposerAttachmentsProps = Omit<PrimitiveProps<"div">, "children"> & {
  children?: ComposerAttachmentsChildren;
  keepMounted?: boolean;
};

const ComposerAttachments = forwardRef<HTMLDivElement, ComposerAttachmentsProps>(
  function ComposerAttachments({ children, keepMounted = false, ...props }, ref) {
    const composer = useComposer();
    const empty = composer.attachments.length === 0;
    if (empty && !keepMounted) {
      return null;
    }

    return renderPrimitive(
      "div",
      {
        ...props,
        children: composer.attachments.map((attachment) => (
          <InternalAttachmentProvider
            key={attachment.id}
            value={{
              attachment,
              remove: () => {
                composer.removeAttachment(attachment.id);
              },
            }}
          >
            {typeof children === "function"
              ? children(attachment)
              : (children ?? <Attachment.Root />)}
          </InternalAttachmentProvider>
        )),
        "data-anvia-composer-attachments": "",
        "data-empty": empty ? "" : undefined,
      } as PrimitiveProps<"div">,
      ref,
    );
  },
);

type ComposerAddAttachmentProps = PrimitiveProps<"button"> & {
  accept?: string;
  multiple?: boolean;
};

type ComposerAttachmentInputProps = PrimitiveProps<"input">;

const ComposerAttachmentInput = forwardRef<HTMLInputElement, ComposerAttachmentInputProps>(
  function ComposerAttachmentInput({ onChange, ...props }, ref) {
    const composer = useComposer();
    const disabled = props.disabled ?? composer.status === "streaming";

    const handleChange = useCallback(
      async (event: ChangeEvent<HTMLInputElement>) => {
        onChange?.(event);
        if (event.defaultPrevented) {
          return;
        }
        const files = Array.from(event.currentTarget.files ?? []);
        event.currentTarget.value = "";
        for (const file of files) {
          await composer.addAttachment(file);
        }
      },
      [composer, onChange],
    );

    return renderPrimitive(
      "input",
      {
        ...props,
        disabled,
        onChange: (event) => {
          void handleChange(event);
        },
        type: "file",
        "data-anvia-attachment-input": "",
        "data-state": disabled ? "disabled" : "enabled",
      } as PrimitiveProps<"input">,
      ref,
    );
  },
);

const ComposerAddAttachment = forwardRef<HTMLButtonElement, ComposerAddAttachmentProps>(
  function ComposerAddAttachment({ accept, multiple = false, onClick, ...props }, ref) {
    const composer = useComposer();
    const inputRef = useRef<HTMLInputElement | null>(null);
    const disabled = props.disabled ?? composer.status === "streaming";

    const handleClick = useCallback(
      (event: MouseEvent<HTMLButtonElement>) => {
        onClick?.(event);
        if (event.defaultPrevented || disabled) {
          return;
        }
        inputRef.current?.click();
      },
      [disabled, onClick],
    );

    return (
      <>
        {renderPrimitive(
          "button",
          {
            ...props,
            children: props.children ?? "Attach",
            disabled,
            onClick: handleClick,
            type: props.type ?? "button",
            "data-anvia-add-attachment": "",
            "data-state": disabled ? "disabled" : "enabled",
          } as PrimitiveProps<"button">,
          ref,
        )}
        <ComposerAttachmentInput
          accept={accept}
          aria-hidden="true"
          hidden
          multiple={multiple}
          ref={inputRef}
          tabIndex={-1}
        />
      </>
    );
  },
);

type ComposerAttachmentDropzoneProps = PrimitiveProps<"div"> & {
  disabled?: boolean;
};

const ComposerAttachmentDropzone = forwardRef<HTMLDivElement, ComposerAttachmentDropzoneProps>(
  function ComposerAttachmentDropzone(
    { disabled: disabledProp = false, onDragLeave, onDragOver, onDrop, ...props },
    ref,
  ) {
    const composer = useComposer();
    const [dragging, setDragging] = useState(false);
    const disabled = disabledProp || composer.status === "streaming";

    const handleDragOver = useCallback(
      (event: DragEvent<HTMLDivElement>) => {
        onDragOver?.(event);
        if (event.defaultPrevented || disabled) {
          return;
        }
        event.preventDefault();
        setDragging(true);
      },
      [disabled, onDragOver],
    );

    const handleDragLeave = useCallback(
      (event: DragEvent<HTMLDivElement>) => {
        onDragLeave?.(event);
        if (!event.defaultPrevented) {
          setDragging(false);
        }
      },
      [onDragLeave],
    );

    const handleDrop = useCallback(
      (event: DragEvent<HTMLDivElement>) => {
        onDrop?.(event);
        if (event.defaultPrevented || disabled) {
          return;
        }
        event.preventDefault();
        setDragging(false);
        const files = Array.from(event.dataTransfer.files);
        void Promise.all(files.map((file) => composer.addAttachment(file)));
      },
      [composer, disabled, onDrop],
    );

    return renderPrimitive(
      "div",
      {
        ...props,
        onDragLeave: handleDragLeave,
        onDragOver: handleDragOver,
        onDrop: handleDrop,
        "data-anvia-attachment-dropzone": "",
        "data-dragging": dragging ? "" : undefined,
        "data-state": disabled ? "disabled" : "enabled",
      } as PrimitiveProps<"div">,
      ref,
    );
  },
);

function createAttachment(attachment: CreateUIAttachment): UIAttachment {
  return {
    ...attachment,
    id: attachment.id ?? createAttachmentId(),
  };
}

function isFileAttachmentInput(attachment: File | CreateUIAttachment): attachment is File {
  return typeof File !== "undefined" && attachment instanceof File;
}

async function attachmentFromFile(file: File): Promise<UIAttachment> {
  return {
    id: createAttachmentId(),
    type: file.type.startsWith("image/") ? "image" : "document",
    name: file.name,
    mediaType: file.type.length > 0 ? file.type : "application/octet-stream",
    data: await readFileData(file),
  };
}

async function readFileData(file: File): Promise<string> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      resolve(String(reader.result ?? ""));
    });
    reader.addEventListener("error", () => {
      reject(reader.error ?? new Error("Failed to read attachment."));
    });
    reader.readAsDataURL(file);
  });
  return dataUrl.includes(",") ? dataUrl.slice(dataUrl.indexOf(",") + 1) : dataUrl;
}

let nextAttachmentId = 0;

function createAttachmentId(): string {
  const random = globalThis.crypto?.randomUUID?.();
  if (random !== undefined) {
    return `attachment_${random}`;
  }
  nextAttachmentId += 1;
  return `attachment_${nextAttachmentId.toString(36)}`;
}

export const Composer = {
  Root: ComposerRoot,
  Quote: ComposerQuotePreview,
  ClearQuote: ComposerClearQuote,
  Input: ComposerInput,
  Attachments: ComposerAttachments,
  AddAttachment: ComposerAddAttachment,
  AttachmentInput: ComposerAttachmentInput,
  AttachmentDropzone: ComposerAttachmentDropzone,
  Submit: ComposerSubmit,
  Stop: ComposerStop,
} as const;
