import type { Icon } from "@phosphor-icons/react";
import {
  BookOpenText,
  Chat,
  Cube,
  Database,
  FlowArrow,
  Gauge,
  ListBullets,
  ListMagnifyingGlass,
  MagnifyingGlass,
  Play,
  Plug,
  Pulse,
  Robot,
  Toolbox,
  Wrench,
} from "@phosphor-icons/react";
import { Button } from "../../components/ui/button";
import { StudioIcon } from "../../components/ui/icon";
import { cn } from "../../lib/utils";

export function NavButton(props: {
  active: boolean;
  icon: IconName;
  label: string;
  onClick: () => void;
  compact?: boolean;
  disabled?: boolean;
}) {
  const Icon = navIcon(props.icon);
  return (
    <Button
      className={cn(
        "h-8 min-h-8 w-full justify-start gap-2 rounded-lg bg-transparent px-2 text-base font-[450] tracking-[-0.006em] text-sidebar-foreground/65 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
        props.active && "bg-sidebar-accent font-semibold text-sidebar-accent-foreground",
        props.compact && "size-10 min-h-10 w-10 justify-center p-0 [&_svg]:size-5",
      )}
      aria-current={props.active ? "page" : undefined}
      aria-label={props.compact ? props.label : undefined}
      title={props.compact ? props.label : undefined}
      variant="ghost"
      type="button"
      disabled={props.disabled}
      onClick={props.onClick}
    >
      <StudioIcon icon={Icon} />
      {props.compact ? null : <span>{props.label}</span>}
    </Button>
  );
}

export type IconName =
  | "activity"
  | "bot"
  | "book-open-text"
  | "container"
  | "database"
  | "database-lightning"
  | "gauge"
  | "inspect"
  | "list"
  | "message"
  | "play"
  | "plug"
  | "search-list"
  | "tools"
  | "wrench"
  | "workflow";

export function navIcon(name: IconName): Icon {
  switch (name) {
    case "activity":
      return Pulse;
    case "bot":
      return Robot;
    case "book-open-text":
      return BookOpenText;
    case "container":
      return Cube;
    case "database":
      return Database;
    case "database-lightning":
      return Database;
    case "gauge":
      return Gauge;
    case "inspect":
      return MagnifyingGlass;
    case "list":
      return ListBullets;
    case "message":
      return Chat;
    case "play":
      return Play;
    case "plug":
      return Plug;
    case "search-list":
      return ListMagnifyingGlass;
    case "tools":
      return Toolbox;
    case "wrench":
      return Wrench;
    case "workflow":
      return FlowArrow;
  }
}
