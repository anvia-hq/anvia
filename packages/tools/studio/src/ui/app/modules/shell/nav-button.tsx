import {
  ActivityIcon as Activity,
  ChatText,
  Database,
  FlowArrow,
  Gauge,
  List,
  type Icon as PhosphorIcon,
  Plug,
  Robot,
  ShieldCheck,
  Wrench,
} from "@phosphor-icons/react";
import { Button } from "../../components/ui/button";
import { cn } from "../../lib/utils";

export function NavButton(props: {
  active: boolean;
  icon: IconName;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  const Icon = navIcon(props.icon);
  return (
    <Button
      className={cn(
        "h-8 min-h-8 w-full justify-start gap-3 rounded-lg bg-transparent px-2.5 text-sm font-medium text-sidebar-foreground/62 shadow-none transition duration-200 hover:bg-sidebar-accent/80 hover:text-sidebar-foreground active:translate-y-px [&_svg]:h-3.5 [&_svg]:w-3.5",
        props.active &&
          "bg-sidebar-accent text-sidebar-accent-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
      )}
      variant="ghost"
      type="button"
      disabled={props.disabled}
      onClick={props.onClick}
    >
      <Icon />
      <span>{props.label}</span>
    </Button>
  );
}

type IconName =
  | "activity"
  | "bot"
  | "database"
  | "gauge"
  | "list"
  | "message"
  | "plug"
  | "shield"
  | "wrench"
  | "workflow";

function navIcon(name: IconName): PhosphorIcon {
  switch (name) {
    case "activity":
      return Activity;
    case "bot":
      return Robot;
    case "database":
      return Database;
    case "gauge":
      return Gauge;
    case "list":
      return List;
    case "message":
      return ChatText;
    case "plug":
      return Plug;
    case "shield":
      return ShieldCheck;
    case "wrench":
      return Wrench;
    case "workflow":
      return FlowArrow;
  }
}
