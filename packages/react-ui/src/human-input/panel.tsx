import { forwardRef } from "react";

import { useHumanInput } from "../contexts";
import { type PrimitiveProps, renderPrimitive } from "../primitives";
import { HumanInputApprovals, type HumanInputFilter } from "./approvals";
import { HumanInputQuestions } from "./questions";

type HumanInputPanelProps = PrimitiveProps<"div"> & {
  filter?: HumanInputFilter;
};

const HumanInputPanel = forwardRef<HTMLDivElement, HumanInputPanelProps>(function HumanInputPanel(
  { children, filter = "pending", ...props },
  ref,
) {
  const humanInput = useHumanInput();
  const approvals = filter === "all" ? humanInput.approvals.all : humanInput.approvals.pending;
  const questions = filter === "all" ? humanInput.questions.all : humanInput.questions.pending;
  if (approvals.length === 0 && questions.length === 0) {
    return null;
  }

  return renderPrimitive(
    "div",
    {
      ...props,
      children: children ?? (
        <>
          <HumanInputApprovals filter={filter} />
          <HumanInputQuestions filter={filter} />
        </>
      ),
      "data-anvia-human-input-panel": "",
    } as PrimitiveProps<"div">,
    ref,
  );
});

export { HumanInputPanel };
