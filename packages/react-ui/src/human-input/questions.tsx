import type { ToolQuestion, ToolQuestionAnswer, ToolQuestionPrompt } from "@anvia/react";
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
  useChatContext,
  useHumanInput,
  useQuestion,
  useQuestionPrompt,
} from "../contexts";
import { type PrimitiveProps, renderPrimitive } from "../primitives";
import type { HumanInputFilter } from "./approvals";

type QuestionChildren = ReactNode | ((question: ToolQuestion) => ReactNode);

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
          <QuestionProvider key={question.id} question={question}>
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
    const prompt = question.questions.find((item) => item.id === promptId) ?? question.questions[0];
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
    const choiceValue = value ?? prompt.choices[0]?.value ?? "";
    const choice = prompt.choices.find((item) => item.value === choiceValue);
    const selected = question.answers[prompt.id]?.choice === choiceValue;

    const handleClick = useCallback(
      (event: MouseEvent<HTMLButtonElement>) => {
        onClick?.(event);
        if (event.defaultPrevented || choiceValue.length === 0) {
          return;
        }
        question.setAnswer(prompt, {
          questionId: prompt.id,
          answer: answer ?? choice?.label ?? choiceValue,
          choice: choiceValue,
          ...(custom ? { custom: true } : {}),
        });
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
    const value = question.answers[prompt.id]?.answer ?? "";

    const handleChange = useCallback(
      (event: ChangeEvent<HTMLTextAreaElement>) => {
        onChange?.(event);
        if (event.defaultPrevented) {
          return;
        }
        const answer = event.currentTarget.value;
        question.setAnswer(prompt, {
          questionId: prompt.id,
          answer,
          custom: true,
        });
      },
      [onChange, prompt, question],
    );

    return renderPrimitive(
      "textarea",
      {
        ...props,
        "aria-label": props["aria-label"] ?? prompt.question,
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
        question.question.questions.flatMap((prompt) => {
          const answer = question.answers[prompt.id];
          return answer === undefined || answer.answer.trim().length === 0 ? [] : [answer];
        }),
      [question],
    );
    const disabled =
      props.disabled ??
      (question.question.status !== "pending" ||
        chat.answeringQuestions.has(question.question.id) ||
        answers.length === 0);

    const handleClick = useCallback(
      (event: MouseEvent<HTMLButtonElement>) => {
        onClick?.(event);
        if (event.defaultPrevented || disabled) {
          return;
        }
        void chat.answerToolQuestion(question.question.id, answers);
      },
      [answers, chat, disabled, onClick, question.question.id],
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
  question: ToolQuestion;
  children?: ReactNode;
}) {
  const [answers, setAnswers] = useState<Record<string, ToolQuestionAnswer>>({});
  const setAnswer = useCallback((prompt: ToolQuestionPrompt, answer: ToolQuestionAnswer) => {
    setAnswers((current) => ({ ...current, [prompt.id]: answer }));
  }, []);
  const value = useMemo<QuestionContextValue>(
    () => ({ question, answers, setAnswer }),
    [answers, question, setAnswer],
  );

  return <InternalQuestionProvider value={value}>{children}</InternalQuestionProvider>;
}

function defaultQuestionContent(question: ToolQuestion): ReactNode {
  return (
    <>
      <div data-anvia-question-tool="">{question.toolName}</div>
      {question.args !== undefined ? <pre data-anvia-question-args="">{question.args}</pre> : null}
      {question.questions.map((prompt) => (
        <HumanInputQuestionPrompt key={prompt.id} promptId={prompt.id} />
      ))}
      <HumanInputQuestionSubmit />
    </>
  );
}

function defaultQuestionPrompt(prompt: ToolQuestionPrompt): ReactNode {
  return (
    <>
      <div data-anvia-question-text="">{prompt.question}</div>
      {prompt.choices.length > 0 ? (
        <div data-anvia-question-choices="">
          {prompt.choices.map((choice) => (
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
