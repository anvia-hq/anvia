import {
  Activity01Icon,
  BookOpenTextIcon,
  ChatIcon,
  DatabaseIcon,
  DatabaseLightningIcon,
  GaugeIcon,
  ListViewIcon,
  Plug01Icon,
  Robot01Icon,
  SearchList01Icon,
  Shield01Icon,
  ToolsIcon,
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
        "studio-sidebar-nav-button h-9 min-h-9 w-full justify-start gap-3 rounded-lg bg-transparent px-2.5 py-0.5 text-base font-medium text-sidebar-foreground/62 shadow-none transition duration-200 hover:text-sidebar-foreground active:translate-y-px [&_svg]:h-[17px] [&_svg]:w-[17px]",
        props.active && "studio-sidebar-nav-button-active text-sidebar-accent-foreground",
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
  | "book-open-text"
  | "database"
  | "database-lightning"
  | "gauge"
  | "list"
  | "message"
  | "plug"
  | "search-list"
  | "shield"
  | "tools"
  | "wrench"
  | "workflow";

function navIcon(name: IconName): IconSvgElement {
  switch (name) {
    case "activity":
      return Activity01Icon;
    case "bot":
      return Robot01Icon;
    case "book-open-text":
      return BookOpenTextIcon;
    case "database":
      return DatabaseIcon;
    case "database-lightning":
      return DatabaseLightningIcon;
    case "gauge":
      return GaugeIcon;
    case "list":
      return ListViewIcon;
    case "message":
      return ChatIcon;
    case "plug":
      return Plug01Icon;
    case "search-list":
      return SearchList01Icon;
    case "shield":
      return Shield01Icon;
    case "tools":
      return ToolsIcon;
    case "wrench":
      return Wrench01Icon;
    case "workflow":
      return WorkflowSquare01Icon;
  }
}
