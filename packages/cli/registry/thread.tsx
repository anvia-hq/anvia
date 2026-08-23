"use client";

import { ThreadPrimitive } from "@anvia/react-ui";
import type { ComponentProps } from "react";
import { Composer } from "./composer";
import { Message } from "./message";

type ThreadProps = Omit<ComponentProps<typeof ThreadPrimitive.Root>, "children">;

export function Thread({ className, ...props }: ThreadProps) {
  return (
    <ThreadPrimitive.Root
      className={["relative flex h-full min-h-0 flex-col bg-background text-foreground", className]
        .filter(Boolean)
        .join(" ")}
      {...props}
    >
      <ThreadPrimitive.Viewport className="min-h-0 flex-1 overflow-y-auto px-4">
        <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col">
          <ThreadPrimitive.Empty className="m-auto py-16 text-center text-sm text-muted-foreground">
            Start a conversation.
          </ThreadPrimitive.Empty>
          <ThreadPrimitive.Messages className="mt-auto py-4">
            <Message />
          </ThreadPrimitive.Messages>
          <ThreadPrimitive.Error className="mb-3 rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive" />
        </div>
      </ThreadPrimitive.Viewport>
      <ThreadPrimitive.ScrollToBottom className="absolute bottom-28 left-1/2 -translate-x-1/2 rounded-full border bg-background px-3 py-2 text-xs shadow-sm data-[state=bottom]:hidden">
        Jump to latest
      </ThreadPrimitive.ScrollToBottom>
      <ThreadPrimitive.ViewportFooter className="mx-auto w-full max-w-3xl px-4 pb-4">
        <Composer />
      </ThreadPrimitive.ViewportFooter>
    </ThreadPrimitive.Root>
  );
}
