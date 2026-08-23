"use client";

import { MessagePrimitive, useChatContext, useMessage } from "@anvia/react-ui";
import type { ComponentProps } from "react";
import { Attachment } from "./attachment";
import { Markdown } from "./markdown";
import { ToolFallback } from "./tool-fallback";

export function Message({ className, ...props }: ComponentProps<typeof MessagePrimitive.Root>) {
  const chat = useChatContext();
  const { message } = useMessage();
  const isLastAssistant = message.role === "assistant" && chat.messages.at(-1)?.id === message.id;

  return (
    <MessagePrimitive.Root
      className={[
        "group flex w-full flex-col gap-2 py-3 data-[role=user]:items-end data-[role=assistant]:items-start",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      {...props}
    >
      <MessagePrimitive.Content className="max-w-[85%] rounded-2xl bg-muted px-4 py-3 text-sm group-data-[role=user]:bg-primary group-data-[role=user]:text-primary-foreground">
        <MessagePrimitive.Parts
          className="grid gap-2"
          stream={{
            flushImmediately: chat.status === "error",
            isStreaming: chat.status === "streaming" && isLastAssistant,
            resetKey: message.id,
          }}
        >
          {(part) => (
            <MessagePrimitive.Part>
              {part.type === "text" ? <Markdown /> : null}
              {part.type === "reasoning" ? (
                <MessagePrimitive.Reasoning className="text-muted-foreground" />
              ) : null}
              {part.type === "tool" ? <ToolFallback /> : null}
              {part.type === "attachment" ? (
                <MessagePrimitive.Attachment>
                  <Attachment />
                </MessagePrimitive.Attachment>
              ) : null}
              {part.type === "data" ? (
                <MessagePrimitive.Data className="overflow-auto whitespace-pre-wrap text-xs" />
              ) : null}
              {part.type === "error" ? (
                <MessagePrimitive.Error className="text-destructive" />
              ) : null}
            </MessagePrimitive.Part>
          )}
        </MessagePrimitive.Parts>
      </MessagePrimitive.Content>
      <MessagePrimitive.Actions className="flex gap-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
        <MessagePrimitive.Copy className="rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground" />
        <MessagePrimitive.Regenerate className="rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground" />
      </MessagePrimitive.Actions>
    </MessagePrimitive.Root>
  );
}
