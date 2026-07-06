import type { UIAttachment } from "@anvia/react";
import { createContext, createElement, type ReactElement, type ReactNode, useContext } from "react";

export type ImageContextValue = {
  attachment: UIAttachment;
  src?: string;
  name?: string;
  mediaType?: string;
  isImage: boolean;
  zoomOpen: boolean;
  setZoomOpen(open: boolean): void;
};

const ImageContext = createContext<ImageContextValue | undefined>(undefined);

export function InternalImageProvider({
  value,
  children,
}: {
  value: ImageContextValue;
  children?: ReactNode;
}): ReactElement {
  return createElement(ImageContext.Provider, { value }, children);
}

export function useImage(): ImageContextValue {
  const value = useContext(ImageContext);
  if (value === undefined) {
    throw new Error("Image primitives must be used inside Image.Root.");
  }
  return value;
}
