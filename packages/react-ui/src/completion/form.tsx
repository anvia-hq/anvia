import {
  type ChangeEvent,
  type FormEvent,
  forwardRef,
  type KeyboardEvent,
  type MouseEvent,
  useCallback,
  useMemo,
} from "react";

import {
  type CompletionInputContextValue,
  InternalCompletionInputProvider,
  useCompletionContext,
  useCompletionInput,
} from "../contexts";
import { type PrimitiveProps, renderPrimitive } from "../primitives";

const CompletionForm = forwardRef<HTMLFormElement, PrimitiveProps<"form">>(function CompletionForm(
  { onSubmit, ...props },
  ref,
) {
  const completion = useCompletionContext();
  const canSubmit = completion.input.trim().length > 0 && completion.status !== "streaming";
  const canStop = completion.status === "streaming";

  const submit = useCallback(async () => {
    if (!canSubmit) {
      return;
    }
    await completion.complete();
  }, [canSubmit, completion]);

  const value = useMemo<CompletionInputContextValue>(
    () => ({
      input: completion.input,
      setInput: completion.setInput,
      submit,
      stop: completion.stop,
      status: completion.status,
      canSubmit,
      canStop,
    }),
    [
      canStop,
      canSubmit,
      completion.input,
      completion.setInput,
      completion.status,
      completion.stop,
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
    <InternalCompletionInputProvider value={value}>
      {renderPrimitive(
        "form",
        {
          ...props,
          onSubmit: handleSubmit,
          "data-anvia-completion-form": "",
          "data-state": completion.status,
        } as PrimitiveProps<"form">,
        ref,
      )}
    </InternalCompletionInputProvider>
  );
});

const CompletionInput = forwardRef<HTMLTextAreaElement, PrimitiveProps<"textarea">>(
  function CompletionInput({ onChange, onKeyDown, ...props }, ref) {
    const input = useCompletionInput();

    const handleChange = useCallback(
      (event: ChangeEvent<HTMLTextAreaElement>) => {
        onChange?.(event);
        if (!event.defaultPrevented) {
          input.setInput(event.currentTarget.value);
        }
      },
      [input, onChange],
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
        void input.submit();
      },
      [input, onKeyDown],
    );

    return renderPrimitive(
      "textarea",
      {
        ...props,
        "aria-label": props["aria-label"] ?? "Prompt",
        disabled: props.disabled ?? input.status === "streaming",
        onChange: handleChange,
        onKeyDown: handleKeyDown,
        value: input.input,
        "data-anvia-completion-input": "",
      } as PrimitiveProps<"textarea">,
      ref,
    );
  },
);

const CompletionSubmit = forwardRef<HTMLButtonElement, PrimitiveProps<"button">>(
  function CompletionSubmit(props, ref) {
    const input = useCompletionInput();
    const disabled = props.disabled ?? !input.canSubmit;

    return renderPrimitive(
      "button",
      {
        ...props,
        children: props.children ?? "Complete",
        disabled,
        type: props.type ?? "submit",
        "data-anvia-completion-submit": "",
        "data-state": disabled ? "disabled" : "enabled",
      } as PrimitiveProps<"button">,
      ref,
    );
  },
);

const CompletionStop = forwardRef<HTMLButtonElement, PrimitiveProps<"button">>(
  function CompletionStop({ onClick, ...props }, ref) {
    const input = useCompletionInput();
    const disabled = props.disabled ?? !input.canStop;

    const handleClick = useCallback(
      (event: MouseEvent<HTMLButtonElement>) => {
        onClick?.(event);
        if (event.defaultPrevented || disabled) {
          return;
        }
        input.stop();
      },
      [disabled, input, onClick],
    );

    return renderPrimitive(
      "button",
      {
        ...props,
        children: props.children ?? "Stop",
        disabled,
        onClick: handleClick,
        type: props.type ?? "button",
        "data-anvia-completion-stop": "",
        "data-state": disabled ? "disabled" : "enabled",
      } as PrimitiveProps<"button">,
      ref,
    );
  },
);

export { CompletionForm, CompletionInput, CompletionStop, CompletionSubmit };
