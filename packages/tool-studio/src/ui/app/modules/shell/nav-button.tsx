import {
  Activity01Icon,
  ChatIcon,
  DatabaseIcon,
  GaugeIcon,
  ListViewIcon,
  Plug01Icon,
  Robot01Icon,
  Shield01Icon,
  WorkflowSquare01Icon,
  Wrench01Icon,
} from "@hugeicons/core-free-icons";
import type { IconSvgElement } from "@hugeicons/react";
import { Button } from "../../components/ui/button";
import { StudioIcon } from "../../components/ui/icon";
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
        "h-9 min-h-9 w-full justify-start gap-3 rounded-lg bg-transparent px-2.5 py-0.5 text-base font-medium text-sidebar-foreground/62 shadow-none transition duration-200 hover:bg-sidebar-accent/80 hover:text-sidebar-foreground active:translate-y-px [&_svg]:h-[17px] [&_svg]:w-[17px]",
        props.active &&
          "bg-sidebar-accent text-sidebar-accent-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
      )}
      variant="ghost"
      type="button"
      disabled={props.disabled}
      onClick={props.onClick}
    >
      <StudioIcon icon={Icon} />
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

function navIcon(name: IconName): IconSvgElement {
  switch (name) {
    case "activity":
      return Activity01Icon;
    case "bot":
      return Robot01Icon;
    case "database":
      return DatabaseIcon;
    case "gauge":
      return GaugeIcon;
    case "list":
      return ListViewIcon;
    case "message":
      return ChatIcon;
    case "plug":
      return Plug01Icon;
    case "shield":
      return Shield01Icon;
    case "wrench":
      return Wrench01Icon;
    case "workflow":
      return WorkflowSquare01Icon;
  }
}
