import type { ToolApprovalContext } from "../../tool/tool";

export type ToolApprovalRequest<Args = unknown> = ToolApprovalContext<Args> & {
  id: string;
  reason?: string | undefined;
  rejectMessage?: string | undefined;
};
