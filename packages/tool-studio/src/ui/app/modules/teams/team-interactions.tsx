import type { AgentInteractionResponse } from "@anvia/core/agent/interactions";
import { useState } from "react";
import { Button } from "../../components/ui/button";
import { Textarea } from "../../components/ui/textarea";
import type { TeamInteraction } from "./team-state";

export function TeamInteractionCard(props: {
  item: TeamInteraction;
  name: string;
  busy: boolean;
  respond: (id: string, response: AgentInteractionResponse) => Promise<boolean>;
}) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const { request, status } = props.item;
  const disabled = props.busy || status !== "pending";
  return (
    <section
      className="space-y-3 rounded-xl border border-hair bg-card p-4"
      aria-label={`${props.name}: ${request.toolName}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <strong>
          {props.name} · {request.toolName}
        </strong>
        <span className="text-muted-foreground">
          {props.busy ? "Submitting…" : status === "pending" ? "Needs your input" : status}
        </span>
      </div>
      <p className="break-all text-xs text-muted-foreground">Instance {props.item.instanceId}</p>
      {request.type === "tool-approval" ? (
        <>
          {request.reason && <p className="text-sm">{request.reason}</p>}
          <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all text-xs">
            {JSON.stringify(request.input, null, 2)}
          </pre>
          <div className="flex gap-2">
            <Button
              size="sm"
              disabled={disabled}
              onClick={() =>
                void props.respond(request.id, { type: "tool-approval", approved: true })
              }
            >
              Approve
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={disabled}
              onClick={() =>
                void props.respond(request.id, { type: "tool-approval", approved: false })
              }
            >
              Deny
            </Button>
          </div>
        </>
      ) : (
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            void props.respond(request.id, {
              type: "tool-question",
              answers: request.questions.map((question) => ({
                questionId: question.id,
                value: answers[question.id] ?? "",
              })),
            });
          }}
        >
          {request.questions.map((question) => (
            <fieldset key={question.id} disabled={disabled} className="space-y-2">
              <legend className="mb-2 text-sm">{question.text}</legend>
              {question.choices?.map((choice) => (
                <label key={choice.value} className="flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name={`${request.id}:${question.id}`}
                    value={choice.value}
                    checked={answers[question.id] === choice.value}
                    onChange={() =>
                      setAnswers((previous) => ({ ...previous, [question.id]: choice.value }))
                    }
                  />
                  {choice.label}
                </label>
              ))}
              {(!question.choices?.length || question.allowCustom) && (
                <Textarea
                  aria-label={question.text}
                  placeholder="Your answer"
                  value={answers[question.id] ?? ""}
                  onChange={(event) =>
                    setAnswers((previous) => ({ ...previous, [question.id]: event.target.value }))
                  }
                />
              )}
            </fieldset>
          ))}
          <Button
            size="sm"
            disabled={
              disabled || request.questions.some((question) => !answers[question.id]?.trim())
            }
          >
            Send answers
          </Button>
        </form>
      )}
    </section>
  );
}
