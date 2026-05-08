import {
  Activity,
  Bot,
  Database,
  List,
  type LucideIcon,
  MessageSquare,
  Plug,
  ShieldCheck,
  Workflow,
  Wrench,
} from "lucide-react";
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
        "h-8 min-h-8 w-full justify-start gap-3 rounded-sm border border-transparent bg-transparent px-2 text-sm font-medium text-sidebar-foreground/62 shadow-none hover:border-sidebar-border hover:bg-sidebar-accent hover:text-sidebar-foreground [&_svg]:h-3.5 [&_svg]:w-3.5",
        props.active &&
          "border-sidebar-border bg-sidebar-accent text-sidebar-accent-foreground hover:border-sidebar-border hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
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
  | "list"
  | "message"
  | "plug"
  | "shield"
  | "wrench"
  | "workflow";

function navIcon(name: IconName): LucideIcon {
  switch (name) {
    case "activity":
      return Activity;
    case "bot":
      return Bot;
    case "database":
      return Database;
    case "list":
      return List;
    case "message":
      return MessageSquare;
    case "plug":
      return Plug;
    case "shield":
      return ShieldCheck;
    case "wrench":
      return Wrench;
    case "workflow":
      return Workflow;
  }
}
