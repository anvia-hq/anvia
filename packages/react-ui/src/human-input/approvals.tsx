import type { ToolApproval } from "@anvia/react";
import { type ChangeEvent, forwardRef, type MouseEvent, type ReactNode, useCallback } from "react";

import { InternalApprovalProvider, useApproval, useChatContext, useHumanInput } from "../contexts";
import { type PrimitiveProps, renderPrimitive } from "../primitives";

type ApprovalChildren = ReactNode | ((approval: ToolApproval) => ReactNode);
type HumanInputFilter = "pending" | "all";

type HumanInputStatusProps = Omit<PrimitiveProps<"div">, "children"> & {
  children?: ReactNode | ((state: ReturnType<typeof useHumanInput>) => ReactNode);
};

const HumanInputStatus = forwardRef<HTMLDivElement, HumanInputStatusProps>(
  function HumanInputStatus({ children, ...props }, ref) {
    const humanInput = useHumanInput();
    const renderedChildren = typeof children === "function" ? children(humanInput) : children;
    const pendingCount = humanInput.approvals.pending.length + humanInput.questions.pending.length;

    return renderPrimitive(
      "div",
      {
        ...props,
        children: renderedChildren ?? `${pendingCount} pending`,
        "data-anvia-human-input-status": "",
        "data-pending": String(pendingCount),
      } as PrimitiveProps<"div">,
      ref,
    );
  },
);

type HumanInputApprovalsProps = PrimitiveProps<"div"> & {
  filter?: HumanInputFilter;
  keepMounted?: boolean;
  children?: ApprovalChildren;
};

const HumanInputApprovals = forwardRef<HTMLDivElement, HumanInputApprovalsProps>(
  function HumanInputApprovals(
    { children, filter = "pending", keepMounted = false, ...props },
    ref,
  ) {
    const humanInput = useHumanInput();
    const approvals = filter === "all" ? humanInput.approvals.all : humanInput.approvals.pending;
    const empty = approvals.length === 0;
    if (empty && !keepMounted) {
      return null;
    }

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
        "data-empty": empty ? "" : undefined,
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
    const { approval, reason } = useApproval();
    const disabled =
      props.disabled ?? (approval.status !== "pending" || chat.decidingApprovals.has(approval.id));

    const handleClick = useCallback(
      (event: MouseEvent<HTMLButtonElement>) => {
        onClick?.(event);
        if (event.defaultPrevented || disabled) {
          return;
        }
        const decisionReason = reason.trim().length > 0 ? reason : undefined;
        void (decisionReason === undefined
          ? chat.approveTool(approval.id)
          : chat.approveTool(approval.id, decisionReason));
      },
      [approval.id, chat, disabled, onClick, reason],
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
    const { approval, reason } = useApproval();
    const disabled =
      props.disabled ?? (approval.status !== "pending" || chat.decidingApprovals.has(approval.id));

    const handleClick = useCallback(
      (event: MouseEvent<HTMLButtonElement>) => {
        onClick?.(event);
        if (event.defaultPrevented || disabled) {
          return;
        }
        const decisionReason = reason.trim().length > 0 ? reason : undefined;
        void (decisionReason === undefined
          ? chat.rejectTool(approval.id)
          : chat.rejectTool(approval.id, decisionReason));
      },
      [approval.id, chat, disabled, onClick, reason],
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

const HumanInputApprovalReason = forwardRef<HTMLTextAreaElement, PrimitiveProps<"textarea">>(
  function HumanInputApprovalReason({ onChange, ...props }, ref) {
    const approval = useApproval();

    const handleChange = useCallback(
      (event: ChangeEvent<HTMLTextAreaElement>) => {
        onChange?.(event);
        if (!event.defaultPrevented) {
          approval.setReason(event.currentTarget.value);
        }
      },
      [approval, onChange],
    );

    return renderPrimitive(
      "textarea",
      {
        ...props,
        "aria-label": props["aria-label"] ?? "Approval reason",
        onChange: handleChange,
        value: approval.reason,
        "data-anvia-approval-reason": "",
      } as PrimitiveProps<"textarea">,
      ref,
    );
  },
);

function defaultApprovalContent(approval: ToolApproval): ReactNode {
  return (
    <>
      <div data-anvia-approval-tool="">{approval.toolName}</div>
      {approval.args !== undefined ? <pre data-anvia-approval-args="">{approval.args}</pre> : null}
      <HumanInputApprovalReason />
      <HumanInputApprove />
      <HumanInputReject />
    </>
  );
}

export type { ApprovalChildren, HumanInputFilter };
export {
  HumanInputApproval,
  HumanInputApprovalReason,
  HumanInputApprovals,
  HumanInputApprove,
  HumanInputReject,
  HumanInputStatus,
};
