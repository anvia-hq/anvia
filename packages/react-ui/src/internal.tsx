import type {
  ToolApproval,
  ToolQuestion,
  ToolQuestionAnswer,
  ToolQuestionPrompt,
  UIMessage,
  UIMessagePart,
  UseChatResult,
  UseCompletionResult,
} from "@anvia/react";
import { Slot } from "@radix-ui/react-slot";
import {
  type ComponentPropsWithoutRef,
  type ComponentPropsWithRef,
  createContext,
  createElement,
  type ElementType,
  type MutableRefObject,
  type ReactElement,
  type ReactNode,
  type Ref,
  type RefCallback,
  useContext,
} from "react";

export type ChatController<TEvent = unknown> = UseChatResult<TEvent>;

export type CompletionController<TEvent = unknown> = UseCompletionResult<TEvent>;

export type ChatProviderProps<TEvent = unknown> = {
  controller: ChatController<TEvent>;
  children?: ReactNode;
};

export type CompletionProviderProps<TEvent = unknown> = {
  controller: CompletionController<TEvent>;
  children?: ReactNode;
};

export type PrimitiveProps<TElement extends ElementType = "div"> = Omit<
  ComponentPropsWithoutRef<TElement>,
  "asChild"
> & {
  asChild?: boolean;
};

export type PrimitiveRef<TElement extends ElementType> = ComponentPropsWithRef<TElement>["ref"];

export type ThreadContextValue = {
  viewportRef: MutableRefObject<HTMLElement | null>;
  atBottom: boolean;
  setAtBottom(atBottom: boolean): void;
  scrollToBottom(behavior?: ScrollBehavior): void;
};

export type ComposerContextValue = {
  input: string;
  setInput(input: string): void;
  submit(): Promise<void>;
  stop(): void;
  status: ChatController["status"];
  canSubmit: boolean;
  canStop: boolean;
};

export type CompletionInputContextValue = {
  input: string;
  setInput(input: string): void;
  submit(): Promise<void>;
  stop(): void;
  status: CompletionController["status"];
  canSubmit: boolean;
  canStop: boolean;
};

export type MessageContextValue = {
  message: UIMessage;
};

export type MessagePartContextValue = {
  part: UIMessagePart;
};

export type ApprovalContextValue = {
  approval: ToolApproval;
};

export type QuestionContextValue = {
  question: ToolQuestion;
  answers: Record<string, ToolQuestionAnswer>;
  setAnswer(prompt: ToolQuestionPrompt, answer: ToolQuestionAnswer): void;
};

export type QuestionPromptContextValue = {
  prompt: ToolQuestionPrompt;
};

const ChatContext = createContext<ChatController | undefined>(undefined);
const CompletionContext = createContext<CompletionController | undefined>(undefined);
const ThreadContext = createContext<ThreadContextValue | undefined>(undefined);
const ComposerContext = createContext<ComposerContextValue | undefined>(undefined);
const CompletionInputContext = createContext<CompletionInputContextValue | undefined>(undefined);
const MessageContext = createContext<MessageContextValue | undefined>(undefined);
const MessagePartContext = createContext<MessagePartContextValue | undefined>(undefined);
const ApprovalContext = createContext<ApprovalContextValue | undefined>(undefined);
const QuestionContext = createContext<QuestionContextValue | undefined>(undefined);
const QuestionPromptContext = createContext<QuestionPromptContextValue | undefined>(undefined);

export function ChatProvider<TEvent = unknown>({
  controller,
  children,
}: ChatProviderProps<TEvent>): ReactElement {
  return createElement(ChatContext.Provider, { value: controller as ChatController }, children);
}

export function CompletionProvider<TEvent = unknown>({
  controller,
  children,
}: CompletionProviderProps<TEvent>): ReactElement {
  return createElement(
    CompletionContext.Provider,
    { value: controller as CompletionController },
    children,
  );
}

export function InternalThreadProvider({
  value,
  children,
}: {
  value: ThreadContextValue;
  children?: ReactNode;
}): ReactElement {
  return createElement(ThreadContext.Provider, { value }, children);
}

export function InternalComposerProvider({
  value,
  children,
}: {
  value: ComposerContextValue;
  children?: ReactNode;
}): ReactElement {
  return createElement(ComposerContext.Provider, { value }, children);
}

export function InternalCompletionInputProvider({
  value,
  children,
}: {
  value: CompletionInputContextValue;
  children?: ReactNode;
}): ReactElement {
  return createElement(CompletionInputContext.Provider, { value }, children);
}

export function InternalMessageProvider({
  message,
  children,
}: {
  message: UIMessage;
  children?: ReactNode;
}): ReactElement {
  return createElement(MessageContext.Provider, { value: { message } }, children);
}

export function InternalMessagePartProvider({
  part,
  children,
}: {
  part: UIMessagePart;
  children?: ReactNode;
}): ReactElement {
  return createElement(MessagePartContext.Provider, { value: { part } }, children);
}

export function InternalApprovalProvider({
  approval,
  children,
}: {
  approval: ToolApproval;
  children?: ReactNode;
}): ReactElement {
  return createElement(ApprovalContext.Provider, { value: { approval } }, children);
}

export function InternalQuestionProvider({
  value,
  children,
}: {
  value: QuestionContextValue;
  children?: ReactNode;
}): ReactElement {
  return createElement(QuestionContext.Provider, { value }, children);
}

export function InternalQuestionPromptProvider({
  prompt,
  children,
}: {
  prompt: ToolQuestionPrompt;
  children?: ReactNode;
}): ReactElement {
  return createElement(QuestionPromptContext.Provider, { value: { prompt } }, children);
}

export function useChatContext<TEvent = unknown>(): ChatController<TEvent> {
  const value = useContext(ChatContext);
  if (value === undefined) {
    throw new Error("Anvia chat primitives must be used inside ChatProvider.");
  }
  return value as ChatController<TEvent>;
}

export function useCompletionContext<TEvent = unknown>(): CompletionController<TEvent> {
  const value = useContext(CompletionContext);
  if (value === undefined) {
    throw new Error("Anvia completion primitives must be used inside CompletionProvider.");
  }
  return value as CompletionController<TEvent>;
}

export function useThread(): ThreadContextValue {
  const value = useContext(ThreadContext);
  if (value === undefined) {
    throw new Error("Thread primitives must be used inside Thread.Root.");
  }
  return value;
}

export function useComposer(): ComposerContextValue {
  const value = useContext(ComposerContext);
  if (value === undefined) {
    throw new Error("Composer primitives must be used inside Composer.Root.");
  }
  return value;
}

export function useCompletionInput(): CompletionInputContextValue {
  const value = useContext(CompletionInputContext);
  if (value === undefined) {
    throw new Error("Completion input primitives must be used inside Completion.Form.");
  }
  return value;
}

export function useMessage(): MessageContextValue {
  const value = useContext(MessageContext);
  if (value === undefined) {
    throw new Error("Message primitives must be used inside Message.Root or Thread.Messages.");
  }
  return value;
}

export function useMessagePart(): MessagePartContextValue {
  const value = useContext(MessagePartContext);
  if (value === undefined) {
    throw new Error("Message part primitives must be used inside Message.Parts or Message.Part.");
  }
  return value;
}

export function useApproval(): ApprovalContextValue {
  const value = useContext(ApprovalContext);
  if (value === undefined) {
    throw new Error("Approval primitives must be used inside HumanInput.Approval.");
  }
  return value;
}

export function useQuestion(): QuestionContextValue {
  const value = useContext(QuestionContext);
  if (value === undefined) {
    throw new Error("Question primitives must be used inside HumanInput.Question.");
  }
  return value;
}

export function useQuestionPrompt(): QuestionPromptContextValue {
  const value = useContext(QuestionPromptContext);
  if (value === undefined) {
    throw new Error("Question choice primitives must be used inside HumanInput.QuestionPrompt.");
  }
  return value;
}

export function useHumanInput(): ChatController["humanInput"] {
  return useChatContext().humanInput;
}

export function renderPrimitive<TElement extends ElementType>(
  element: TElement,
  props: PrimitiveProps<TElement>,
  ref?: Ref<unknown>,
): ReactElement {
  const { asChild, ...rest } = props;
  const Component = asChild ? Slot : element;
  const nextProps = ref === undefined ? rest : { ...rest, ref };
  return createElement(Component, nextProps);
}

export function composeRefs<T>(...refs: Array<Ref<T> | undefined>): RefCallback<T> {
  return (node) => {
    for (const ref of refs) {
      if (typeof ref === "function") {
        ref(node);
      } else if (ref !== undefined && ref !== null) {
        ref.current = node;
      }
    }
  };
}

export function stringifyValue(value: unknown): string {
  if (value === undefined) {
    return "";
  }
  if (typeof value === "string") {
    return value;
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function messageText(message: UIMessage): string {
  return message.parts
    .filter((part): part is Extract<UIMessagePart, { type: "text" }> => part.type === "text")
    .map((part) => part.text)
    .join("");
}
