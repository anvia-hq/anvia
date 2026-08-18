import type { AgentQuestionAnswer, AgentQuestionPrompt } from "@anvia/core/agent/interactions";
import {
  type ChangeEvent,
  forwardRef,
  type MouseEvent,
  type ReactNode,
  useCallback,
  useMemo,
  useState,
} from "react";

import {
  InternalQuestionPromptProvider,
  InternalQuestionProvider,
  type QuestionContextValue,
  type QuestionInteraction,
  useChatContext,
  useHumanInput,
  useQuestion,
  useQuestionPrompt,
} from "../contexts";
import { type PrimitiveProps, renderPrimitive } from "../primitives";
import type { HumanInputFilter } from "./approvals";

type QuestionChildren = ReactNode | ((question: QuestionInteraction) => ReactNode);

type HumanInputQuestionsProps = PrimitiveProps<"div"> & {
  filter?: HumanInputFilter;
  keepMounted?: boolean;
  children?: QuestionChildren;
};

const HumanInputQuestions = forwardRef<HTMLDivElement, HumanInputQuestionsProps>(
  function HumanInputQuestions(
    { children, filter = "pending", keepMounted = false, ...props },
    ref,
  ) {
    const humanInput = useHumanInput();
    const questions = filter === "all" ? humanInput.questions.all : humanInput.questions.pending;
    const empty = questions.length === 0;
    if (empty && !keepMounted) {
      return null;
    }

    return renderPrimitive(
      "div",
      {
        ...props,
        children: questions.map((question) => (
          <QuestionProvider key={question.request.id} question={question}>
            {typeof children === "function"
              ? children(question)
              : (children ?? <HumanInputQuestion />)}
          </QuestionProvider>
        )),
        "data-anvia-questions": "",
        "data-empty": empty ? "" : undefined,
      } as PrimitiveProps<"div">,
      ref,
    );
  },
);

type HumanInputQuestionProps = PrimitiveProps<"div"> & {
  children?: QuestionChildren;
};

const HumanInputQuestion = forwardRef<HTMLDivElement, HumanInputQuestionProps>(
  function HumanInputQuestion({ children, ...props }, ref) {
    const { question } = useQuestion();
    const renderedChildren =
      typeof children === "function"
        ? children(question)
        : (children ?? defaultQuestionContent(question));

    return renderPrimitive(
      "div",
      {
        ...props,
        children: renderedChildren,
        "data-anvia-question": "",
        "data-state": question.status,
      } as PrimitiveProps<"div">,
      ref,
    );
  },
);

type HumanInputQuestionPromptProps = PrimitiveProps<"div"> & {
  promptId?: string;
};

const HumanInputQuestionPrompt = forwardRef<HTMLDivElement, HumanInputQuestionPromptProps>(
  function HumanInputQuestionPrompt({ promptId, ...props }, ref) {
    const { question } = useQuestion();
    const prompt =
      question.request.questions.find((item) => item.id === promptId) ??
      question.request.questions[0];
    if (prompt === undefined) {
      return null;
    }

    return (
      <InternalQuestionPromptProvider prompt={prompt}>
        {renderPrimitive(
          "div",
          {
            ...props,
            children: props.children ?? defaultQuestionPrompt(prompt),
            "data-anvia-question-prompt": "",
          } as PrimitiveProps<"div">,
          ref,
        )}
      </InternalQuestionPromptProvider>
    );
  },
);

type HumanInputQuestionChoiceProps = PrimitiveProps<"button"> & {
  value?: string;
  answer?: string;
  custom?: boolean;
};

const HumanInputQuestionChoice = forwardRef<HTMLButtonElement, HumanInputQuestionChoiceProps>(
  function HumanInputQuestionChoice({ answer, custom = false, onClick, value, ...props }, ref) {
    const { prompt } = useQuestionPrompt();
    const question = useQuestion();
    const choiceValue = value ?? prompt.choices?.[0]?.value ?? "";
    const choice = prompt.choices?.find((item) => item.value === choiceValue);
    const selected = question.answers[prompt.id]?.value === choiceValue;

    const handleClick = useCallback(
      (event: MouseEvent<HTMLButtonElement>) => {
        onClick?.(event);
        if (event.defaultPrevented || choiceValue.length === 0) {
          return;
        }
        const nextAnswer: AgentQuestionAnswer = {
          questionId: prompt.id,
          value: custom ? (answer ?? choice?.label ?? choiceValue) : choiceValue,
        };
        question.setAnswer(prompt, nextAnswer);
      },
      [answer, choice?.label, choiceValue, custom, onClick, prompt, question],
    );

    return renderPrimitive(
      "button",
      {
        ...props,
        children: props.children ?? choice?.label ?? choiceValue,
        onClick: handleClick,
        type: props.type ?? "button",
        "data-anvia-question-choice": "",
        "data-state": selected ? "selected" : "idle",
      } as PrimitiveProps<"button">,
      ref,
    );
  },
);

const HumanInputQuestionTextAnswer = forwardRef<HTMLTextAreaElement, PrimitiveProps<"textarea">>(
  function HumanInputQuestionTextAnswer({ onChange, ...props }, ref) {
    const { prompt } = useQuestionPrompt();
    const question = useQuestion();
    const value = question.answers[prompt.id]?.value ?? "";

    const handleChange = useCallback(
      (event: ChangeEvent<HTMLTextAreaElement>) => {
        onChange?.(event);
        if (event.defaultPrevented) {
          return;
        }
        const answer = event.currentTarget.value;
        question.setAnswer(prompt, {
          questionId: prompt.id,
          value: answer,
        });
      },
      [onChange, prompt, question],
    );

    return renderPrimitive(
      "textarea",
      {
        ...props,
        "aria-label": props["aria-label"] ?? prompt.text,
        onChange: handleChange,
        value,
        "data-anvia-question-text-answer": "",
      } as PrimitiveProps<"textarea">,
      ref,
    );
  },
);

const HumanInputQuestionSubmit = forwardRef<HTMLButtonElement, PrimitiveProps<"button">>(
  function HumanInputQuestionSubmit({ onClick, ...props }, ref) {
    const chat = useChatContext();
    const question = useQuestion();
    const answers = useMemo(
      () =>
        question.question.request.questions.flatMap((prompt) => {
          const answer = question.answers[prompt.id];
          return answer === undefined || answer.value.trim().length === 0 ? [] : [answer];
        }),
      [question],
    );
    const disabled =
      props.disabled ??
      (question.question.status !== "pending" ||
        chat.respondingInteractions.has(question.question.request.id) ||
        answers.length !== question.question.request.questions.length);

    const handleClick = useCallback(
      (event: MouseEvent<HTMLButtonElement>) => {
        onClick?.(event);
        if (event.defaultPrevented || disabled) {
          return;
        }
        void chat.respondToInteraction({
          interactionId: question.question.request.id,
          response: { type: "tool-question", answers },
        });
      },
      [answers, chat, disabled, onClick, question.question.request.id],
    );

    return renderPrimitive(
      "button",
      {
        ...props,
        children: props.children ?? "Submit",
        disabled,
        onClick: handleClick,
        type: props.type ?? "button",
        "data-anvia-question-submit": "",
        "data-state": disabled ? "disabled" : "enabled",
      } as PrimitiveProps<"button">,
      ref,
    );
  },
);

function QuestionProvider({
  question,
  children,
}: {
  question: QuestionInteraction;
  children?: ReactNode;
}) {
  const [answers, setAnswers] = useState<Record<string, AgentQuestionAnswer>>({});
  const setAnswer = useCallback((prompt: AgentQuestionPrompt, answer: AgentQuestionAnswer) => {
    setAnswers((current) => ({ ...current, [prompt.id]: answer }));
  }, []);
  const value = useMemo<QuestionContextValue>(
    () => ({ question, answers, setAnswer }),
    [answers, question, setAnswer],
  );

  return <InternalQuestionProvider value={value}>{children}</InternalQuestionProvider>;
}

function defaultQuestionContent(question: QuestionInteraction): ReactNode {
  return (
    <>
      <div data-anvia-question-tool="">{question.request.toolName}</div>
      {question.request.questions.map((prompt) => (
        <HumanInputQuestionPrompt key={prompt.id} promptId={prompt.id} />
      ))}
      <HumanInputQuestionSubmit />
    </>
  );
}

function defaultQuestionPrompt(prompt: AgentQuestionPrompt): ReactNode {
  return (
    <>
      <div data-anvia-question-text="">{prompt.text}</div>
      {(prompt.choices?.length ?? 0) > 0 ? (
        <div data-anvia-question-choices="">
          {prompt.choices?.map((choice) => (
            <HumanInputQuestionChoice key={choice.value} value={choice.value}>
              {choice.label}
            </HumanInputQuestionChoice>
          ))}
        </div>
      ) : (
        <HumanInputQuestionTextAnswer />
      )}
    </>
  );
}

export type { QuestionChildren };
export {
  HumanInputQuestion,
  HumanInputQuestionChoice,
  HumanInputQuestionPrompt,
  HumanInputQuestionSubmit,
  HumanInputQuestions,
  HumanInputQuestionTextAnswer,
};
