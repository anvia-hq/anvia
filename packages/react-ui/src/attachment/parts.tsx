import type { UIAttachment } from "@anvia/client";
import { forwardRef, type MouseEvent, type ReactNode, useCallback } from "react";

import { useAttachment } from "../contexts";
import { type PrimitiveProps, renderPrimitive } from "../primitives";

type AttachmentChildren = ReactNode | ((attachment: UIAttachment) => ReactNode);

type AttachmentRootProps = Omit<PrimitiveProps<"div">, "children"> & {
  children?: AttachmentChildren;
};

const AttachmentRoot = forwardRef<HTMLDivElement, AttachmentRootProps>(function AttachmentRoot(
  { children, ...props },
  ref,
) {
  const { attachment, remove } = useAttachment();
  const renderedChildren =
    typeof children === "function" ? children(attachment) : (children ?? defaultAttachment(remove));

  return renderPrimitive(
    "div",
    {
      ...props,
      children: renderedChildren,
    } as PrimitiveProps<"div">,
    ref,
  );
});

const AttachmentName = forwardRef<HTMLSpanElement, PrimitiveProps<"span">>(
  function AttachmentName(props, ref) {
    const { attachment } = useAttachment();

    return renderPrimitive(
      "span",
      {
        ...props,
        children: props.children ?? attachmentLabel(attachment),
      } as PrimitiveProps<"span">,
      ref,
    );
  },
);

const AttachmentPreview = forwardRef<HTMLDivElement, PrimitiveProps<"div">>(
  function AttachmentPreview(props, ref) {
    const { attachment } = useAttachment();

    return renderPrimitive(
      "div",
      {
        ...props,
        children: props.children ?? defaultPreview(attachment),
      } as PrimitiveProps<"div">,
      ref,
    );
  },
);

const AttachmentRemove = forwardRef<HTMLButtonElement, PrimitiveProps<"button">>(
  function AttachmentRemove({ onClick, ...props }, ref) {
    const { remove } = useAttachment();
    const disabled = props.disabled ?? remove === undefined;

    const handleClick = useCallback(
      (event: MouseEvent<HTMLButtonElement>) => {
        onClick?.(event);
        if (event.defaultPrevented || disabled) {
          return;
        }
        remove?.();
      },
      [disabled, onClick, remove],
    );

    return renderPrimitive(
      "button",
      {
        ...props,
        children: props.children ?? "Remove",
        disabled,
        onClick: handleClick,
        type: props.type ?? "button",
        "data-state": disabled ? "disabled" : "enabled",
      } as PrimitiveProps<"button">,
      ref,
    );
  },
);

function defaultAttachment(remove: (() => void) | undefined): ReactNode {
  return (
    <>
      <AttachmentPreview />
      <AttachmentName />
      {remove === undefined ? null : <AttachmentRemove />}
    </>
  );
}

function defaultPreview(attachment: UIAttachment): ReactNode {
  if (isImageAttachment(attachment)) {
    const source = attachment.url ?? attachmentDataUrl(attachment);
    if (source !== undefined) {
      return <img alt={attachment.name ?? "Attachment"} src={source} />;
    }
  }

  if (attachment.url !== undefined) {
    return <a href={attachment.url}>{attachmentLabel(attachment)}</a>;
  }

  return <span>{attachment.mediaType ?? attachment.type}</span>;
}

function attachmentLabel(attachment: UIAttachment): string {
  return attachment.name ?? attachment.mediaType ?? attachment.type;
}

function isImageAttachment(attachment: UIAttachment): boolean {
  return attachment.type === "image" || attachment.mediaType?.startsWith("image/") === true;
}

function attachmentDataUrl(attachment: UIAttachment): string | undefined {
  if (attachment.data === undefined || attachment.mediaType === undefined) {
    return undefined;
  }
  return `data:${attachment.mediaType};base64,${attachment.data}`;
}

export { AttachmentName, AttachmentPreview, AttachmentRemove, AttachmentRoot };
