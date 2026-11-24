import { AttachmentName, AttachmentPreview, AttachmentRemove, AttachmentRoot } from "./parts";

export const AttachmentPrimitive = {
  Root: AttachmentRoot,
  Name: AttachmentName,
  Preview: AttachmentPreview,
  Remove: AttachmentRemove,
} as const;

export type { AttachmentContextValue } from "../contexts";
export { useAttachment } from "../contexts";
