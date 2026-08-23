"use client";

import { MessagePrimitive } from "@anvia/react-ui";
import type { ComponentProps } from "react";

export function Markdown({
  className,
  ...props
}: ComponentProps<typeof MessagePrimitive.Markdown>) {
  return (
    <MessagePrimitive.Markdown
      className={[
        "anvia-markdown max-w-none text-sm leading-7 text-current [&_a]:text-primary [&_a]:underline [&_a]:underline-offset-2 [&_blockquote]:border-l-2 [&_blockquote]:pl-4 [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_h1]:mt-6 [&_h1]:text-2xl [&_h1]:font-semibold [&_h2]:mt-5 [&_h2]:text-xl [&_h2]:font-semibold [&_h3]:mt-4 [&_h3]:text-lg [&_h3]:font-semibold [&_li]:ml-5 [&_ol]:list-decimal [&_p]:my-3 [&_pre]:overflow-auto [&_pre]:rounded-xl [&_pre]:bg-muted [&_pre]:p-4 [&_strong]:font-semibold [&_table]:w-full [&_ul]:list-disc",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      {...props}
    />
  );
}
