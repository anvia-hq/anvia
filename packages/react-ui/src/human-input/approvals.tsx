import type { ToolApproval } from "@anvia/react";
import { forwardRef, type MouseEvent, type ReactNode, useCallback } from "react";

import { InternalApprovalProvider, useApproval, useChatContext, useHumanInput } from "../contexts";
import { type PrimitiveProps, renderPrimitive } from "../primitives";

type ApprovalChildren = ReactNode | ((approval: ToolApproval) => ReactNode);
type HumanInputFilter = "pending" | "all";

type HumanInputApprovalsProps = PrimitiveProps<"div"> & {
  filter?: HumanInputFilter;
  children?: ApprovalChildren;
};

const HumanInputApprovals = forwardRef<HTMLDivElement, HumanInputApprovalsProps>(
  function HumanInputApprovals({ children, filter = "pending", ...props }, ref) {
    const humanInput = useHumanInput();
    const approvals = filter === "all" ? humanInput.approvals.all : humanInput.approvals.pending;

    return renderPrimitive(
      "div",
      {
        ...props,
        children: approvals.map((approval) => (
          <InternalApprovalProvider key={approval.id} approval={approval}>
            {typeof children === "function"
              ? children(approval)
              : (children ?? <HumanInputApproval />)}
          </InternalApprovalProvider>
        )),
        "data-anvia-approvals": "",
      } as PrimitiveProps<"div">,
      ref,
    );
  },
);

type HumanInputApprovalProps = PrimitiveProps<"div"> & {
  children?: ApprovalChildren;
};

const HumanInputApproval = forwardRef<HTMLDivElement, HumanInputApprovalProps>(
  function HumanInputApproval({ children, ...props }, ref) {
    const { approval } = useApproval();
    const renderedChildren =
      typeof children === "function"
        ? children(approval)
        : (children ?? defaultApprovalContent(approval));

    return renderPrimitive(
      "div",
      {
        ...props,
        children: renderedChildren,
        "data-anvia-approval": "",
        "data-state": approval.status,
      } as PrimitiveProps<"div">,
      ref,
    );
  },
);

const HumanInputApprove = forwardRef<HTMLButtonElement, PrimitiveProps<"button">>(
  function HumanInputApprove({ onClick, ...props }, ref) {
    const chat = useChatContext();
    const { approval } = useApproval();
    const disabled =
      props.disabled ?? (approval.status !== "pending" || chat.decidingApprovals.has(approval.id));

    const handleClick = useCallback(
      (event: MouseEvent<HTMLButtonElement>) => {
        onClick?.(event);
        if (event.defaultPrevented || disabled) {
          return;
        }
        void chat.approveTool(approval.id);
      },
      [approval.id, chat, disabled, onClick],
    );

    return renderPrimitive(
      "button",
      {
        ...props,
        children: props.children ?? "Approve",
        disabled,
        onClick: handleClick,
        type: props.type ?? "button",
        "data-anvia-approve": "",
        "data-state": disabled ? "disabled" : "enabled",
      } as PrimitiveProps<"button">,
      ref,
    );
  },
);

const HumanInputReject = forwardRef<HTMLButtonElement, PrimitiveProps<"button">>(
  function HumanInputReject({ onClick, ...props }, ref) {
    const chat = useChatContext();
    const { approval } = useApproval();
    const disabled =
      props.disabled ?? (approval.status !== "pending" || chat.decidingApprovals.has(approval.id));

    const handleClick = useCallback(
      (event: MouseEvent<HTMLButtonElement>) => {
        onClick?.(event);
        if (event.defaultPrevented || disabled) {
          return;
        }
        void chat.rejectTool(approval.id);
      },
      [approval.id, chat, disabled, onClick],
    );

    return renderPrimitive(
      "button",
      {
        ...props,
        children: props.children ?? "Reject",
        disabled,
        onClick: handleClick,
        type: props.type ?? "button",
        "data-anvia-reject": "",
        "data-state": disabled ? "disabled" : "enabled",
      } as PrimitiveProps<"button">,
      ref,
    );
  },
);

function defaultApprovalContent(approval: ToolApproval): ReactNode {
  return (
    <>
      <div data-anvia-approval-tool="">{approval.toolName}</div>
      {approval.args !== undefined ? <pre data-anvia-approval-args="">{approval.args}</pre> : null}
      <HumanInputApprove />
      <HumanInputReject />
    </>
  );
}

export type { ApprovalChildren, HumanInputFilter };
export { HumanInputApproval, HumanInputApprovals, HumanInputApprove, HumanInputReject };
