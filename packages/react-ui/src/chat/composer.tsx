import {
  type ChangeEvent,
  type FormEvent,
  forwardRef,
  type KeyboardEvent,
  type MouseEvent,
  useCallback,
  useMemo,
  useState,
} from "react";

import {
  type ComposerContextValue,
  InternalComposerProvider,
  useChatContext,
  useComposer,
} from "../contexts";
import { type PrimitiveProps, renderPrimitive } from "../primitives";

const ComposerRoot = forwardRef<HTMLFormElement, PrimitiveProps<"form">>(function ComposerRoot(
  { onSubmit, ...props },
  ref,
) {
  const chat = useChatContext();
  const [input, setInput] = useState("");
  const canSubmit = input.trim().length > 0 && chat.status !== "streaming";
  const canStop = chat.status === "streaming";

  const submit = useCallback(async () => {
    const prompt = input;
    if (prompt.trim().length === 0 || chat.status === "streaming") {
      return;
    }
    setInput("");
    await chat.sendMessage(prompt);
  }, [chat, input]);

  const value = useMemo<ComposerContextValue>(
    () => ({
      input,
      setInput,
      submit,
      stop: chat.stop,
      status: chat.status,
      canSubmit,
      canStop,
    }),
    [canStop, canSubmit, chat.status, chat.stop, input, submit],
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

const ComposerInput = forwardRef<HTMLTextAreaElement, PrimitiveProps<"textarea">>(
  function ComposerInput({ onChange, onKeyDown, ...props }, ref) {
    const composer = useComposer();

    const handleChange = useCallback(
      (event: ChangeEvent<HTMLTextAreaElement>) => {
        onChange?.(event);
        if (!event.defaultPrevented) {
          composer.setInput(event.currentTarget.value);
        }
      },
      [composer, onChange],
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
        value: composer.input,
        "data-anvia-composer-input": "",
      } as PrimitiveProps<"textarea">,
      ref,
    );
  },
);

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

export const Composer = {
  Root: ComposerRoot,
  Input: ComposerInput,
  Submit: ComposerSubmit,
  Stop: ComposerStop,
} as const;
