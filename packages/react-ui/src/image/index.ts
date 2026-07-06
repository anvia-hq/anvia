import {
  ImageActions,
  ImageCopy,
  ImageDownload,
  ImageName,
  ImagePreview,
  ImageRoot,
  ImageZoomOverlay,
  ImageZoomTrigger,
} from "./parts";

export const Image = {
  Root: ImageRoot,
  Preview: ImagePreview,
  Name: ImageName,
  Actions: ImageActions,
  Copy: ImageCopy,
  Download: ImageDownload,
  ZoomTrigger: ImageZoomTrigger,
  ZoomOverlay: ImageZoomOverlay,
} as const;

export type { ImageContextValue } from "../contexts";
export { useImage } from "../contexts";
