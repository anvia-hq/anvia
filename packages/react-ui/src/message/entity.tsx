import { forwardRef, type HTMLAttributes } from "react";
import type { ComposerEntity } from "../contexts";

export type MessageEntityProps = HTMLAttributes<HTMLSpanElement> & {
  entity: ComposerEntity;
};

const MessageEntity = forwardRef<HTMLSpanElement, MessageEntityProps>(function MessageEntity(
  { children, entity, ...props },
  ref,
) {
  return (
    <span
      {...props}
      data-anvia-message-entity=""
      data-entity-id={entity.id}
      data-trigger-id={entity.triggerId}
      ref={ref}
    >
      {children ?? entity.text}
    </span>
  );
});

export { MessageEntity };
