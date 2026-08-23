"use client";

import { ComposerPrimitive } from "@anvia/react-ui";
import type { ComponentProps } from "react";
import { Attachment } from "./attachment";

type ComposerProps = Omit<ComponentProps<typeof ComposerPrimitive.Root>, "children">;

export function Composer({ className, ...props }: ComposerProps) {
  return (
    <ComposerPrimitive.Root
      className={["relative rounded-2xl border bg-background p-2 shadow-lg", className]
        .filter(Boolean)
        .join(" ")}
      {...props}
    >
      <ComposerPrimitive.Attachments className="mb-2 flex flex-wrap gap-2 px-1">
        <Attachment />
      </ComposerPrimitive.Attachments>
      <ComposerPrimitive.Quote className="mx-1 mb-2 rounded-lg border-l-2 border-primary bg-muted px-3 py-2 text-sm" />
      <ComposerPrimitive.Input
        className="min-h-12 max-h-48 overflow-y-auto px-2 py-3 text-sm outline-none [&_.ProseMirror]:outline-none"
        placeholder="Send a message..."
      />
      <ComposerPrimitive.TriggerMenu className="z-50 max-h-72 min-w-56 overflow-auto rounded-xl border bg-popover p-1 text-popover-foreground shadow-md">
        {(trigger) =>
          trigger.loading ? (
            <div className="px-3 py-2 text-sm text-muted-foreground">Loading...</div>
          ) : (
            trigger.items.map((item, index) => (
              <ComposerPrimitive.TriggerItem
                className="flex w-full items-center rounded-lg px-3 py-2 text-left text-sm data-[state=selected]:bg-accent data-[state=disabled]:opacity-50"
                index={index}
                item={item}
                key={item.id}
              />
            ))
          )
        }
      </ComposerPrimitive.TriggerMenu>
      <div className="flex items-center justify-between gap-2 px-1 pb-1">
        <ComposerPrimitive.AddAttachment className="rounded-lg px-3 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground">
          Attach
        </ComposerPrimitive.AddAttachment>
        <div className="flex items-center gap-2">
          <ComposerPrimitive.Stop className="rounded-lg border px-3 py-2 text-sm data-[state=disabled]:hidden">
            Stop
          </ComposerPrimitive.Stop>
          <ComposerPrimitive.Submit className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:pointer-events-none disabled:opacity-50">
            Send
          </ComposerPrimitive.Submit>
        </div>
      </div>
    </ComposerPrimitive.Root>
  );
}
