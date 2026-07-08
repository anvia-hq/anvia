import type { CreateUIAttachment, UIAttachment } from "@anvia/react";
import type { Editor, Extensions, JSONContent } from "@tiptap/core";
import { mergeAttributes } from "@tiptap/core";
import Document from "@tiptap/extension-document";
import HardBreak from "@tiptap/extension-hard-break";
import Mention, { type MentionOptions } from "@tiptap/extension-mention";
import Paragraph from "@tiptap/extension-paragraph";
import Placeholder from "@tiptap/extension-placeholder";
import Text from "@tiptap/extension-text";
import { PluginKey } from "@tiptap/pm/state";
import { EditorContent, useEditor } from "@tiptap/react";
import type {
  SuggestionKeyDownProps,
  SuggestionOptions,
  SuggestionProps,
} from "@tiptap/suggestion";
import {
  type ChangeEvent,
  type CSSProperties,
  type DragEvent,
  type FormEvent,
  forwardRef,
  type MouseEvent,
  type KeyboardEvent as ReactKeyboardEvent,
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
  type ComposerEntitiesUpdate,
  type ComposerEntity,
  type ComposerEntityData,
  type ComposerQuote,
  type ComposerTriggerDefinition,
  type ComposerTriggerItem as ComposerTriggerItemValue,
  type ComposerTriggerState,
  InternalAttachmentProvider,
  InternalComposerProvider,
  useChatContext,
  useComposer,
} from "../contexts";
import { composeRefs, type PrimitiveProps, renderPrimitive } from "../primitives";

type ComposerRootProps = PrimitiveProps<"form"> & {
  attachments?: UIAttachment[];
  defaultAttachments?: UIAttachment[];
  defaultEntities?: ComposerEntity[];
  defaultInput?: string;
  defaultQuote?: ComposerQuote | undefined;
  entities?: ComposerEntity[];
  input?: string;
  onAttachmentsChange?: (attachments: UIAttachment[]) => void;
  onEntitiesChange?: (entities: ComposerEntity[]) => void;
  onInputChange?: (input: string) => void;
  onQuoteChange?: (quote: ComposerQuote | undefined) => void;
  quote?: ComposerQuote | undefined;
  submitMessage?: ComposerSubmitMessage;
  triggers?: ComposerTriggerDefinition[];
};

export type ComposerSubmitMessageArgs<TEvent = unknown> = {
  input: string;
  attachments: UIAttachment[];
  entities: ComposerEntity[];
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
    defaultEntities,
    defaultInput = "",
    defaultQuote,
    entities: entitiesProp,
    input: inputProp,
    onAttachmentsChange,
    onEntitiesChange,
    onInputChange,
    onQuoteChange,
    quote: quoteProp,
    submitMessage,
    triggers: triggersProp,
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
  const [uncontrolledEntities, setUncontrolledEntities] = useState<ComposerEntity[]>(() => [
    ...(defaultEntities ?? []),
  ]);
  const [uncontrolledQuote, setUncontrolledQuote] = useState<ComposerQuote | undefined>(
    defaultQuote,
  );
  const [activeTrigger, setActiveTriggerState] = useState<ComposerTriggerState | undefined>();
  const input = inputProp ?? uncontrolledInput;
  const attachments = attachmentsProp ?? uncontrolledAttachments;
  const entities = entitiesProp ?? uncontrolledEntities;
  const triggers = triggersProp ?? EMPTY_COMPOSER_TRIGGERS;
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
  const entitiesRef = useRef(entities);
  entitiesRef.current = entities;
  const inputControlled = inputProp !== undefined;
  const attachmentsControlled = attachmentsProp !== undefined;
  const entitiesControlled = entitiesProp !== undefined;
  const quoteControlled = quoteProp !== undefined;
  const hasMessageContent =
    input.trim().length > 0 || attachments.length > 0 || entities.length > 0 || quote !== undefined;
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

  const setEntities = useCallback(
    (update: ComposerEntitiesUpdate) => {
      const nextEntities = typeof update === "function" ? update(entitiesRef.current) : update;
      entitiesRef.current = nextEntities;
      if (!entitiesControlled) {
        setUncontrolledEntities(nextEntities);
      }
      onEntitiesChange?.(nextEntities);
    },
    [entitiesControlled, onEntitiesChange],
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
    setEntities([]);
    setActiveTriggerState(undefined);
    clearQuote();
  }, [clearQuote, setAttachments, setEntities, setInput]);

  const submit = useCallback(async () => {
    const prompt = input;
    if (
      (prompt.trim().length === 0 &&
        attachments.length === 0 &&
        entities.length === 0 &&
        quote === undefined) ||
      chat.status === "streaming"
    ) {
      return;
    }
    if (submitMessage !== undefined) {
      await submitMessage({
        input: prompt,
        attachments,
        entities,
        chat,
        quote,
        clear,
      });
      return;
    }
    const submittedText = quote === undefined ? prompt : promptWithQuote(prompt, quote);
    const metadata = composerSubmitMetadata(quote, entities);
    if (attachments.length === 0) {
      if (metadata === undefined) {
        await chat.sendMessage(prompt);
      } else {
        await chat.sendMessage({
          text: submittedText,
          metadata,
        });
      }
    } else {
      await chat.sendMessage({
        text: submittedText,
        attachments,
        ...(metadata === undefined ? {} : { metadata }),
      });
    }
    clear();
  }, [attachments, chat, clear, entities, input, quote, submitMessage]);

  const setActiveTrigger = useCallback((update: Parameters<typeof setActiveTriggerState>[0]) => {
    setActiveTriggerState(update);
  }, []);

  const value = useMemo<ComposerContextValue>(
    () => ({
      input,
      setInput,
      attachments,
      setAttachments,
      addAttachment,
      removeAttachment,
      clearAttachments,
      entities,
      setEntities,
      quote,
      setQuote,
      clearQuote,
      triggers,
      activeTrigger,
      setActiveTrigger,
      submit,
      stop: chat.stop,
      status: chat.status,
      canSubmit,
      canStop,
    }),
    [
      addAttachment,
      attachments,
      activeTrigger,
      canStop,
      canSubmit,
      chat.status,
      chat.stop,
      clearAttachments,
      clearQuote,
      entities,
      input,
      quote,
      removeAttachment,
      setAttachments,
      setActiveTrigger,
      setEntities,
      setInput,
      setQuote,
      submit,
      triggers,
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

type ComposerInputProps = PrimitiveProps<"div"> & {
  autoResize?: boolean;
  disabled?: boolean | undefined;
  maxRows?: number;
  minRows?: number;
  placeholder?: string | undefined;
};

const ComposerInput = forwardRef<HTMLDivElement, ComposerInputProps>(function ComposerInput(
  {
    autoResize = true,
    disabled,
    maxRows: maxRowsProp,
    minRows: minRowsProp,
    onKeyDown,
    placeholder,
    style,
    ...props
  },
  ref,
) {
  const composer = useComposer();
  const composerRef = useRef(composer);
  composerRef.current = composer;
  const editorReadyRef = useRef(false);
  const syncingFromEditorRef = useRef(false);
  const triggers = composer.triggers;
  const minRows = normalizeRows(minRowsProp ?? 1, 1);
  const maxRows = normalizeRows(maxRowsProp ?? 6, minRows);
  const extensions = useMemo(
    () =>
      composerInputExtensions({
        composerRef,
        placeholder,
        triggers,
      }),
    [placeholder, triggers],
  );
  const editor = useEditor(
    {
      extensions,
      content: plainTextToComposerContent(composer.input),
      editable: composer.status !== "streaming",
      editorProps: {
        attributes: {
          "aria-label": props["aria-label"] ?? "Message",
          "aria-multiline": "true",
          "data-anvia-composer-editor": "",
          role: "textbox",
        },
      },
      onUpdate: ({ editor: updatedEditor }) => {
        if (!editorReadyRef.current) {
          return;
        }
        const snapshot = composerSnapshotFromEditor(
          updatedEditor,
          composerRef.current.entities,
          composerRef.current.triggers,
        );
        syncingFromEditorRef.current = true;
        composerRef.current.setInput(snapshot.input);
        composerRef.current.setEntities(snapshot.entities);
      },
    },
    [extensions],
  );
  const ariaDisabled = props["aria-disabled"] === true || props["aria-disabled"] === "true";
  const composerDisabled = disabled === true || ariaDisabled || composer.status === "streaming";
  const inputStyle = useMemo<CSSProperties | undefined>(() => {
    if (!autoResize) {
      return style;
    }
    const rowsStyle: CSSProperties = {
      ["--anvia-composer-min-rows" as string]: minRows,
      ["--anvia-composer-max-rows" as string]: maxRows,
    };
    return style === undefined ? rowsStyle : { ...rowsStyle, ...style };
  }, [autoResize, maxRows, minRows, style]);
  const handleKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
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
      void composerRef.current.submit();
    },
    [onKeyDown],
  );

  useEffect(() => {
    if (editor === null) {
      return;
    }
    editor.setEditable(!composerDisabled, false);
  }, [composerDisabled, editor]);

  useEffect(() => {
    if (editor === null) {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (submitComposerFromEditorKeyDown(event, composerRef)) {
        event.stopPropagation();
      }
    };
    editor.view.dom.addEventListener("keydown", handleKeyDown, true);
    return () => {
      editor.view.dom.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [editor]);

  useEffect(() => {
    if (editor === null) {
      return;
    }
    editor.commands.setContent(plainTextToComposerContent(composerRef.current.input), {
      emitUpdate: false,
    });
    editorReadyRef.current = true;
    return () => {
      editorReadyRef.current = false;
    };
  }, [editor]);

  useEffect(() => {
    if (editor === null || !editorReadyRef.current) {
      return;
    }
    if (syncingFromEditorRef.current) {
      syncingFromEditorRef.current = false;
      return;
    }
    const snapshot = composerSnapshotFromEditor(editor, composer.entities, composer.triggers);
    if (snapshot.input === composer.input) {
      return;
    }
    editor.commands.setContent(plainTextToComposerContent(composer.input), {
      emitUpdate: false,
    });
  }, [composer, editor]);

  return renderPrimitive(
    "div",
    {
      ...props,
      children: <EditorContent editor={editor} />,
      "aria-disabled": composerDisabled ? true : props["aria-disabled"],
      "data-anvia-composer-input": "",
      "data-state": composerDisabled ? "disabled" : "enabled",
      "data-auto-resize": autoResize ? "" : undefined,
      onKeyDown: handleKeyDown,
      style: inputStyle,
    } as PrimitiveProps<"div">,
    ref,
  );
});

type ComposerTextareaInputProps = PrimitiveProps<"textarea"> & {
  autoResize?: boolean;
  maxRows?: number;
  minRows?: number;
};

const ComposerTextareaInput = forwardRef<HTMLTextAreaElement, ComposerTextareaInputProps>(
  function ComposerTextareaInput(
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
          composer.setEntities([]);
          if (autoResize) {
            resizeComposerInput(event.currentTarget, { maxRows, minRows });
          }
        }
      },
      [autoResize, composer, maxRows, minRows, onChange],
    );

    const handleKeyDown = useCallback(
      (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
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
        "data-anvia-composer-textarea-input": "",
      } as PrimitiveProps<"textarea">,
      composedInputRef,
    );
  },
);

const COMPOSER_ENTITY_NODE = "composerEntity";
const EMPTY_COMPOSER_TRIGGERS: ComposerTriggerDefinition[] = [];

type ComposerRef = {
  current: ComposerContextValue;
};

type ComposerEntityAttrs = {
  id?: string | null | undefined;
  label?: string | null | undefined;
  mentionSuggestionChar?: string | null | undefined;
  triggerId?: string | null | undefined;
  text?: string | null | undefined;
  data?: ComposerEntityData | undefined;
};

type ComposerInputExtensionsOptions = {
  composerRef: ComposerRef;
  placeholder?: string | undefined;
  triggers: ComposerTriggerDefinition[];
};

type ComposerDocumentSnapshot = {
  input: string;
  entities: ComposerEntity[];
};

const ComposerEntityExtension = Mention.extend<
  MentionOptions<ComposerTriggerItemValue, ComposerEntityAttrs>
>({
  name: COMPOSER_ENTITY_NODE,

  addAttributes() {
    return {
      id: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-id"),
        renderHTML: (attributes) =>
          attributes.id === undefined || attributes.id === null
            ? {}
            : { "data-id": String(attributes.id) },
      },
      label: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-label"),
        renderHTML: (attributes) =>
          attributes.label === undefined || attributes.label === null
            ? {}
            : { "data-label": String(attributes.label) },
      },
      mentionSuggestionChar: {
        default: "@",
        parseHTML: (element) => element.getAttribute("data-mention-suggestion-char"),
        renderHTML: (attributes) => ({
          "data-mention-suggestion-char": attributes.mentionSuggestionChar,
        }),
      },
      triggerId: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-trigger-id"),
        renderHTML: (attributes) =>
          attributes.triggerId === undefined || attributes.triggerId === null
            ? {}
            : { "data-trigger-id": String(attributes.triggerId) },
      },
      text: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-text"),
        renderHTML: (attributes) =>
          attributes.text === undefined || attributes.text === null
            ? {}
            : { "data-text": String(attributes.text) },
      },
      data: {
        default: null,
        parseHTML: (element) => dataFromAttribute(element.getAttribute("data-entity-data")),
        renderHTML: (attributes) =>
          attributes.data === undefined || attributes.data === null
            ? {}
            : { "data-entity-data": JSON.stringify(attributes.data) },
      },
    };
  },
});

function composerInputExtensions({
  composerRef,
  placeholder,
  triggers,
}: ComposerInputExtensionsOptions): Extensions {
  return [
    Document,
    Paragraph,
    Text,
    HardBreak,
    Placeholder.configure(placeholder === undefined ? {} : { placeholder }),
    ComposerEntityExtension.configure({
      HTMLAttributes: {
        "data-anvia-composer-entity": "",
      },
      deleteTriggerWithBackspace: true,
      renderText: ({ node }) => composerEntityText(node.attrs as ComposerEntityAttrs),
      renderHTML: ({ node, options }) => [
        "span",
        mergeAttributes(options.HTMLAttributes, {
          "data-anvia-composer-entity": "",
        }),
        composerEntityText(node.attrs as ComposerEntityAttrs),
      ],
      suggestions: triggers.map((trigger) => composerSuggestion(trigger, composerRef)),
    }),
  ];
}

function submitComposerFromEditorKeyDown(event: KeyboardEvent, composerRef: ComposerRef): boolean {
  if (
    event.defaultPrevented ||
    event.key !== "Enter" ||
    event.shiftKey ||
    event.isComposing ||
    composerRef.current.activeTrigger !== undefined
  ) {
    return false;
  }
  event.preventDefault();
  void composerRef.current.submit();
  return true;
}

type ComposerSuggestionOptions = Omit<
  SuggestionOptions<ComposerTriggerItemValue, ComposerEntityAttrs>,
  "editor"
>;

function composerSuggestion(
  trigger: ComposerTriggerDefinition,
  composerRef: ComposerRef,
): ComposerSuggestionOptions {
  const pluginKey = new PluginKey(`anvia-composer-trigger-${trigger.id}`);

  return {
    pluginKey,
    char: trigger.char,
    ...(trigger.allowSpaces === undefined ? {} : { allowSpaces: trigger.allowSpaces }),
    ...(trigger.allowedPrefixes === undefined ? {} : { allowedPrefixes: trigger.allowedPrefixes }),
    ...(trigger.startOfLine === undefined ? {} : { startOfLine: trigger.startOfLine }),
    ...(trigger.minQueryLength === undefined ? {} : { minQueryLength: trigger.minQueryLength }),
    items: ({ query, signal }: { query: string; signal: AbortSignal }) =>
      resolveTriggerItems(trigger, query, composerRef.current, signal),
    command: ({
      editor,
      range,
      props,
    }: {
      editor: Editor;
      range: { from: number; to: number };
      props: ComposerEntityAttrs;
    }) => {
      const nodeAfter = editor.view.state.selection.$to.nodeAfter;
      const overrideSpace = nodeAfter?.text?.startsWith(" ");
      const insertRange = {
        from: range.from,
        to: overrideSpace ? range.to + 1 : range.to,
      };
      editor
        .chain()
        .focus()
        .insertContentAt(insertRange, [
          {
            type: COMPOSER_ENTITY_NODE,
            attrs: props,
          },
          {
            type: "text",
            text: " ",
          },
        ])
        .run();
      editor.view.dom.ownerDocument.defaultView?.getSelection()?.collapseToEnd();
      composerRef.current.setActiveTrigger(undefined);
    },
    render: () => ({
      onStart: (props: SuggestionProps<ComposerTriggerItemValue, ComposerEntityAttrs>) => {
        updateComposerTriggerState(trigger, props, composerRef);
      },
      onUpdate: (props: SuggestionProps<ComposerTriggerItemValue, ComposerEntityAttrs>) => {
        updateComposerTriggerState(trigger, props, composerRef);
      },
      onExit: () => {
        composerRef.current.setActiveTrigger((current) =>
          current?.trigger.id === trigger.id ? undefined : current,
        );
      },
      onKeyDown: (props: SuggestionKeyDownProps) =>
        handleComposerTriggerKeyDown(trigger, props, composerRef),
    }),
  };
}

function resolveTriggerItems(
  trigger: ComposerTriggerDefinition,
  query: string,
  composer: ComposerContextValue,
  signal: AbortSignal,
): ComposerTriggerItemValue[] | Promise<ComposerTriggerItemValue[]> {
  if (Array.isArray(trigger.items)) {
    const normalizedQuery = query.toLowerCase();
    return trigger.items.filter((item) => item.label.toLowerCase().includes(normalizedQuery));
  }
  return trigger.items({
    trigger,
    query,
    input: composer.input,
    entities: composer.entities,
    signal,
  });
}

function updateComposerTriggerState(
  trigger: ComposerTriggerDefinition,
  props: SuggestionProps<ComposerTriggerItemValue, ComposerEntityAttrs>,
  composerRef: ComposerRef,
): void {
  const current = composerRef.current.activeTrigger;
  const selectedIndex =
    current?.trigger.id === trigger.id ? clampIndex(current.selectedIndex, props.items.length) : 0;
  const rect = rectFromSuggestion(props);
  composerRef.current.setActiveTrigger({
    trigger,
    query: props.query,
    items: props.items,
    loading: props.loading,
    selectedIndex,
    ...(rect === undefined ? {} : { rect }),
    selectItem: (item) => {
      if (item.disabled) {
        return;
      }
      props.command(triggerItemToEntityAttrs(trigger, item));
    },
    setSelectedIndex: (index) => {
      composerRef.current.setActiveTrigger((active) =>
        active?.trigger.id === trigger.id
          ? { ...active, selectedIndex: clampIndex(index, active.items.length) }
          : active,
      );
    },
  });
}

function handleComposerTriggerKeyDown(
  trigger: ComposerTriggerDefinition,
  { event }: SuggestionKeyDownProps,
  composerRef: ComposerRef,
): boolean {
  const activeTrigger = composerRef.current.activeTrigger;
  if (activeTrigger?.trigger.id !== trigger.id) {
    return false;
  }

  if (event.key === "ArrowDown") {
    event.preventDefault();
    activeTrigger.setSelectedIndex(activeTrigger.selectedIndex + 1);
    return true;
  }

  if (event.key === "ArrowUp") {
    event.preventDefault();
    activeTrigger.setSelectedIndex(activeTrigger.selectedIndex - 1);
    return true;
  }

  if (event.key === "Enter" || event.key === "Tab") {
    event.preventDefault();
    const item = activeTrigger.items[activeTrigger.selectedIndex];
    if (item !== undefined) {
      activeTrigger.selectItem(item);
    }
    return true;
  }

  if (event.key === "Escape") {
    composerRef.current.setActiveTrigger(undefined);
    return false;
  }

  return false;
}

function triggerItemToEntityAttrs(
  trigger: ComposerTriggerDefinition,
  item: ComposerTriggerItemValue,
): ComposerEntityAttrs {
  return {
    id: item.id,
    label: item.label,
    mentionSuggestionChar: trigger.char,
    triggerId: trigger.id,
    text: triggerItemText(trigger, item),
    data: item.data,
  };
}

function triggerItemText(
  trigger: ComposerTriggerDefinition,
  item: ComposerTriggerItemValue,
): string {
  return item.text ?? `${trigger.char}${item.label}`;
}

function rectFromSuggestion(
  props: SuggestionProps<ComposerTriggerItemValue, ComposerEntityAttrs>,
): ComposerTriggerState["rect"] {
  const rect = props.clientRect?.();
  if (rect === undefined || rect === null) {
    return undefined;
  }
  return {
    top: rect.top,
    right: rect.right,
    bottom: rect.bottom,
    left: rect.left,
    width: rect.width,
    height: rect.height,
  };
}

function clampIndex(index: number, length: number): number {
  if (length <= 0) {
    return 0;
  }
  return (index + length) % length;
}

function plainTextToComposerContent(input: string): JSONContent {
  const lines = input.length === 0 ? [""] : input.split(/\r?\n/);
  return {
    type: "doc",
    content: lines.map((line) => ({
      type: "paragraph",
      ...(line.length === 0
        ? {}
        : {
            content: [
              {
                type: "text",
                text: line,
              },
            ],
          }),
    })),
  };
}

function composerSnapshotFromEditor(
  editor: Editor,
  previousEntities: ComposerEntity[],
  triggers: ComposerTriggerDefinition[],
): ComposerDocumentSnapshot {
  return composerSnapshotFromContent(editor.getJSON(), previousEntities, triggers);
}

function composerSnapshotFromContent(
  content: JSONContent,
  previousEntities: ComposerEntity[],
  triggers: ComposerTriggerDefinition[],
): ComposerDocumentSnapshot {
  const entities: ComposerEntity[] = [];
  let input = "";
  let blockIndex = 0;

  const appendNode = (node: JSONContent): void => {
    if (node.type === "doc") {
      for (const child of node.content ?? []) {
        appendNode(child);
      }
      return;
    }

    if (node.type === "paragraph") {
      if (blockIndex > 0) {
        input += "\n";
      }
      blockIndex += 1;
      for (const child of node.content ?? []) {
        appendNode(child);
      }
      return;
    }

    if (node.type === "text") {
      input += node.text ?? "";
      return;
    }

    if (node.type === "hardBreak") {
      input += "\n";
      return;
    }

    if (node.type === COMPOSER_ENTITY_NODE) {
      const attrs = node.attrs as ComposerEntityAttrs | undefined;
      const entity = composerEntityFromAttrs(attrs, input.length, previousEntities, triggers);
      input += entity.text;
      entities.push(entity);
      return;
    }

    for (const child of node.content ?? []) {
      appendNode(child);
    }
  };

  appendNode(content);
  return { input, entities };
}

function composerEntityFromAttrs(
  attrs: ComposerEntityAttrs | undefined,
  from: number,
  previousEntities: ComposerEntity[],
  triggers: ComposerTriggerDefinition[],
): ComposerEntity {
  const id = stringAttr(attrs?.id) ?? "";
  const trigger = stringAttr(attrs?.mentionSuggestionChar) ?? "@";
  const triggerId =
    stringAttr(attrs?.triggerId) ??
    triggers.find((candidate) => candidate.char === trigger)?.id ??
    trigger;
  const label = stringAttr(attrs?.label) ?? id;
  const text = composerEntityText(attrs);
  const previous = previousEntities.find(
    (entity) => entity.id === id && entity.triggerId === triggerId && entity.trigger === trigger,
  );
  const data = attrs?.data ?? previous?.data;
  return {
    id,
    triggerId,
    trigger,
    label,
    text,
    range: {
      from,
      to: from + text.length,
    },
    ...(data === undefined ? {} : { data }),
  };
}

function composerEntityText(attrs: ComposerEntityAttrs | undefined): string {
  const text = stringAttr(attrs?.text);
  if (text !== undefined) {
    return text;
  }
  const trigger = stringAttr(attrs?.mentionSuggestionChar) ?? "@";
  return `${trigger}${stringAttr(attrs?.label) ?? stringAttr(attrs?.id) ?? ""}`;
}

function stringAttr(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function dataFromAttribute(value: string | null): ComposerEntityData | null {
  if (value === null) {
    return null;
  }
  try {
    return JSON.parse(value) as ComposerEntityData;
  } catch {
    return null;
  }
}

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

function composerSubmitMetadata(
  quote: ComposerQuote | undefined,
  entities: ComposerEntity[],
):
  | {
      quote?: ComposerQuote;
      composer?: {
        entities: ComposerEntity[];
      };
    }
  | undefined {
  if (quote === undefined && entities.length === 0) {
    return undefined;
  }
  return {
    ...(quote === undefined ? {} : { quote }),
    ...(entities.length === 0
      ? {}
      : {
          composer: {
            entities,
          },
        }),
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

type ComposerTriggerMenuChildren = ReactNode | ((trigger: ComposerTriggerState) => ReactNode);

type ComposerTriggerMenuProps = Omit<PrimitiveProps<"div">, "children"> & {
  children?: ComposerTriggerMenuChildren;
  keepMounted?: boolean;
};

const ComposerTriggerMenu = forwardRef<HTMLDivElement, ComposerTriggerMenuProps>(
  function ComposerTriggerMenu({ children, keepMounted = false, style, ...props }, ref) {
    const composer = useComposer();
    const activeTrigger = composer.activeTrigger;
    const empty = activeTrigger === undefined;
    if (empty && !keepMounted) {
      return null;
    }

    const menuStyle =
      activeTrigger?.rect === undefined
        ? style
        : ({
            position: "fixed",
            top: activeTrigger.rect.bottom,
            left: activeTrigger.rect.left,
            ...style,
          } satisfies CSSProperties);
    const renderedChildren =
      activeTrigger === undefined
        ? typeof children === "function"
          ? null
          : children
        : typeof children === "function"
          ? children(activeTrigger)
          : (children ??
            activeTrigger.items.map((item, index) => (
              <ComposerTriggerItem key={`${item.id}:${index.toString()}`} index={index} />
            )));

    return renderPrimitive(
      "div",
      {
        ...props,
        children: renderedChildren,
        role: props.role ?? "listbox",
        style: menuStyle,
        "data-anvia-composer-trigger-menu": "",
        "data-empty": empty ? "" : undefined,
        "data-loading": activeTrigger?.loading ? "" : undefined,
        "data-trigger": activeTrigger?.trigger.char,
        "data-trigger-id": activeTrigger?.trigger.id,
      } as PrimitiveProps<"div">,
      ref,
    );
  },
);

type ComposerTriggerItemChildren =
  | ReactNode
  | ((item: ComposerTriggerItemValue, trigger: ComposerTriggerState) => ReactNode);

type ComposerTriggerItemProps = Omit<PrimitiveProps<"button">, "children"> & {
  children?: ComposerTriggerItemChildren;
  index?: number | undefined;
  item?: ComposerTriggerItemValue | undefined;
};

const ComposerTriggerItem = forwardRef<HTMLButtonElement, ComposerTriggerItemProps>(
  function ComposerTriggerItem(
    { children, index, item: itemProp, onClick, onMouseEnter, ...props },
    ref,
  ) {
    const composer = useComposer();
    const activeTrigger = composer.activeTrigger;
    const itemIndex = index ?? 0;
    const item = itemProp ?? activeTrigger?.items[itemIndex];
    if (activeTrigger === undefined || item === undefined) {
      return null;
    }

    const selected = activeTrigger.selectedIndex === itemIndex;
    const disabled = props.disabled ?? item.disabled ?? false;
    const renderedChildren =
      typeof children === "function" ? children(item, activeTrigger) : (children ?? item.label);

    const handleMouseEnter = (event: MouseEvent<HTMLButtonElement>) => {
      onMouseEnter?.(event);
      if (!event.defaultPrevented && !disabled) {
        activeTrigger.setSelectedIndex(itemIndex);
      }
    };
    const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
      onClick?.(event);
      if (!event.defaultPrevented && !disabled) {
        activeTrigger.selectItem(item);
      }
    };

    return renderPrimitive(
      "button",
      {
        ...props,
        children: renderedChildren,
        disabled,
        onClick: handleClick,
        onMouseEnter: handleMouseEnter,
        role: props.role ?? "option",
        type: props.type ?? "button",
        "aria-selected": selected,
        "data-anvia-composer-trigger-item": "",
        "data-disabled": disabled ? "" : undefined,
        "data-item-id": item.id,
        "data-selected": selected ? "" : undefined,
        "data-trigger": activeTrigger.trigger.char,
        "data-trigger-id": activeTrigger.trigger.id,
      } as PrimitiveProps<"button">,
      ref,
    );
  },
);

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
  TextareaInput: ComposerTextareaInput,
  TriggerMenu: ComposerTriggerMenu,
  TriggerItem: ComposerTriggerItem,
  Attachments: ComposerAttachments,
  AddAttachment: ComposerAddAttachment,
  AttachmentInput: ComposerAttachmentInput,
  AttachmentDropzone: ComposerAttachmentDropzone,
  Submit: ComposerSubmit,
  Stop: ComposerStop,
} as const;
