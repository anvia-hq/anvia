"use client";

import type { ComponentProps } from "react";
import { Thread } from "./thread";

export function Chat(props: ComponentProps<typeof Thread>) {
  return <Thread {...props} />;
}
