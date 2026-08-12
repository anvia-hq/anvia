import type { Icon, IconProps } from "@phosphor-icons/react";

export type StudioIconProps = IconProps & {
  icon: Icon;
};

export function StudioIcon({ icon: IconComponent, weight = "regular", ...props }: StudioIconProps) {
  return <IconComponent weight={weight} {...props} />;
}
