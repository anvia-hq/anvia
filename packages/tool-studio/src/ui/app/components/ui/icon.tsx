import { HugeiconsIcon, type HugeiconsIconProps, type IconSvgElement } from "@hugeicons/react";

export type StudioIconProps = Omit<HugeiconsIconProps, "icon"> & {
  icon: IconSvgElement;
};

export function StudioIcon({
  color = "currentColor",
  strokeWidth = 1.5,
  ...props
}: StudioIconProps) {
  return <HugeiconsIcon color={color} strokeWidth={strokeWidth} {...props} />;
}
