import type { UIAttachment } from "@anvia/react";
import {
  forwardRef,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

import {
  type ImageContextValue,
  InternalImageProvider,
  useImage,
  useOptionalAttachment,
} from "../contexts";
import { composeRefs, type PrimitiveProps, renderPrimitive } from "../primitives";

type ImageRootChildren = ReactNode | ((image: ImageContextValue) => ReactNode);
type ImageRenderWhen = "image" | "always";

type ImageRootProps = Omit<PrimitiveProps<"figure">, "children"> & {
  attachment?: UIAttachment;
  children?: ImageRootChildren;
  renderWhen?: ImageRenderWhen;
};

const ImageRoot = forwardRef<HTMLElement, ImageRootProps>(function ImageRoot(
  { attachment: attachmentProp, children, renderWhen = "image", ...props },
  ref,
) {
  const attachmentContext = useOptionalAttachment();
  const attachment = attachmentProp ?? attachmentContext?.attachment;
  const [zoomOpen, setZoomOpen] = useState(false);

  if (attachment === undefined) {
    throw new Error("Image.Root requires an attachment prop or Attachment context.");
  }

  const src = imageSource(attachment);
  const isImage = isImageAttachment(attachment);
  const value = useMemo<ImageContextValue>(() => {
    const context: ImageContextValue = {
      attachment,
      isImage,
      zoomOpen,
      setZoomOpen,
    };
    if (src !== undefined) context.src = src;
    if (attachment.name !== undefined) context.name = attachment.name;
    if (attachment.mediaType !== undefined) context.mediaType = attachment.mediaType;
    return context;
  }, [attachment, attachment.mediaType, attachment.name, isImage, src, zoomOpen]);
  if (!isImage && renderWhen !== "always") {
    return null;
  }

  const renderedChildren = typeof children === "function" ? children(value) : children;

  return (
    <InternalImageProvider value={value}>
      {renderPrimitive(
        "figure",
        {
          ...props,
          children: renderedChildren ?? (
            <>
              <ImagePreview />
              <ImageName />
            </>
          ),
          "data-anvia-image": "",
          "data-state": src === undefined ? "unavailable" : "ready",
          "data-type": attachment.type,
        } as PrimitiveProps<"figure">,
        ref,
      )}
    </InternalImageProvider>
  );
});

type ImagePreviewProps = Omit<PrimitiveProps<"div">, "children"> & {
  alt?: string;
  errorFallback?: ReactNode;
  loadingFallback?: ReactNode;
};

const ImagePreview = forwardRef<HTMLDivElement, ImagePreviewProps>(function ImagePreview(
  { alt, errorFallback, loadingFallback, ...props },
  ref,
) {
  const image = useImage();
  const [state, setState] = useState<"loading" | "ready" | "error">(
    image.src === undefined ? "error" : "loading",
  );

  useEffect(() => {
    setState(image.src === undefined ? "error" : "loading");
  }, [image.src]);

  const fallback =
    state === "loading"
      ? (loadingFallback ?? "Loading image")
      : state === "error"
        ? (errorFallback ?? "Image unavailable")
        : null;

  return renderPrimitive(
    "div",
    {
      ...props,
      children:
        image.src === undefined ? (
          fallback
        ) : (
          <>
            {state === "ready" ? null : <span data-anvia-image-fallback="">{fallback}</span>}
            <img
              alt={alt ?? image.name ?? "Image"}
              data-anvia-image-img=""
              hidden={state !== "ready"}
              onError={() => setState("error")}
              onLoad={() => setState("ready")}
              src={image.src}
            />
          </>
        ),
      "data-anvia-image-preview": "",
      "data-state": state,
    } as PrimitiveProps<"div">,
    ref,
  );
});

const ImageName = forwardRef<HTMLElement, PrimitiveProps<"figcaption">>(
  function ImageName(props, ref) {
    const image = useImage();

    return renderPrimitive(
      "figcaption",
      {
        ...props,
        children: props.children ?? image.name ?? image.mediaType ?? image.attachment.type,
        "data-anvia-image-name": "",
      } as PrimitiveProps<"figcaption">,
      ref,
    );
  },
);

const ImageActions = forwardRef<HTMLDivElement, PrimitiveProps<"div">>(
  function ImageActions(props, ref) {
    return renderPrimitive(
      "div",
      {
        ...props,
        "data-anvia-image-actions": "",
      } as PrimitiveProps<"div">,
      ref,
    );
  },
);

type ImageActionState = "idle" | "done" | "error";

const ImageCopy = forwardRef<HTMLButtonElement, PrimitiveProps<"button">>(function ImageCopy(
  { onClick, ...props },
  ref,
) {
  const image = useImage();
  const [copyState, setCopyState] = useState<ImageActionState>("idle");
  const disabled = props.disabled ?? image.src === undefined;

  const handleClick = useCallback(
    async (event: MouseEvent<HTMLButtonElement>) => {
      onClick?.(event);
      if (event.defaultPrevented || disabled || image.src === undefined) {
        return;
      }
      try {
        await copyImage(image);
        setCopyState("done");
      } catch {
        setCopyState("error");
      }
    },
    [disabled, image, onClick],
  );

  return renderPrimitive(
    "button",
    {
      ...props,
      children: props.children ?? "Copy image",
      disabled,
      onClick: handleClick,
      type: props.type ?? "button",
      "data-anvia-image-copy": "",
      "data-state": copyState,
    } as PrimitiveProps<"button">,
    ref,
  );
});

type ImageDownloadProps = PrimitiveProps<"button"> & {
  filename?: string;
};

const ImageDownload = forwardRef<HTMLButtonElement, ImageDownloadProps>(function ImageDownload(
  { filename, onClick, ...props },
  ref,
) {
  const image = useImage();
  const disabled = props.disabled ?? image.src === undefined;

  const handleClick = useCallback(
    async (event: MouseEvent<HTMLButtonElement>) => {
      onClick?.(event);
      if (event.defaultPrevented || disabled || image.src === undefined) {
        return;
      }
      try {
        await downloadImage(image, filename);
      } catch {
        return;
      }
    },
    [disabled, filename, image, onClick],
  );

  return renderPrimitive(
    "button",
    {
      ...props,
      children: props.children ?? "Download",
      disabled,
      onClick: handleClick,
      type: props.type ?? "button",
      "data-anvia-image-download": "",
      "data-state": disabled ? "disabled" : "enabled",
    } as PrimitiveProps<"button">,
    ref,
  );
});

const ImageZoomTrigger = forwardRef<HTMLButtonElement, PrimitiveProps<"button">>(
  function ImageZoomTrigger({ onClick, ...props }, ref) {
    const image = useImage();
    const disabled = props.disabled ?? image.src === undefined;

    const handleClick = useCallback(
      (event: MouseEvent<HTMLButtonElement>) => {
        onClick?.(event);
        if (event.defaultPrevented || disabled) {
          return;
        }
        image.setZoomOpen(true);
      },
      [disabled, image, onClick],
    );

    return renderPrimitive(
      "button",
      {
        ...props,
        children: props.children ?? "Open image",
        disabled,
        onClick: handleClick,
        type: props.type ?? "button",
        "data-anvia-image-zoom-trigger": "",
        "data-state": disabled ? "disabled" : "enabled",
      } as PrimitiveProps<"button">,
      ref,
    );
  },
);

type ImageZoomOverlayProps = Omit<PrimitiveProps<"div">, "children"> & {
  container?: Element | DocumentFragment;
};

const ImageZoomOverlay = forwardRef<HTMLDivElement, ImageZoomOverlayProps>(
  function ImageZoomOverlay({ container, onClick, onKeyDown, ...props }, ref) {
    const image = useImage();
    const portalContainer = container ?? globalThis.document?.body;
    const overlayRef = useRef<HTMLDivElement | null>(null);
    const composedRef = useMemo(() => composeRefs(overlayRef, ref), [ref]);

    useEffect(() => {
      if (!image.zoomOpen) {
        return;
      }
      const document = globalThis.document;
      if (document === undefined) {
        return;
      }
      const handleKeyDown = (event: globalThis.KeyboardEvent) => {
        if (event.key === "Escape") {
          image.setZoomOpen(false);
        }
      };
      document.addEventListener("keydown", handleKeyDown);
      return () => {
        document.removeEventListener("keydown", handleKeyDown);
      };
    }, [image.setZoomOpen, image.zoomOpen]);

    useEffect(() => {
      if (!image.zoomOpen) {
        return;
      }
      const activeElement = globalThis.document?.activeElement;
      const previousFocus = activeElement instanceof HTMLElement ? activeElement : undefined;
      focusOverlay(overlayRef.current);
      return () => {
        if (previousFocus?.isConnected === true) {
          previousFocus.focus();
        }
      };
    }, [image.zoomOpen]);

    const handleClick = useCallback(
      (event: MouseEvent<HTMLDivElement>) => {
        onClick?.(event);
        if (!event.defaultPrevented) {
          image.setZoomOpen(false);
        }
      },
      [image, onClick],
    );

    const handleKeyDown = useCallback(
      (event: KeyboardEvent<HTMLDivElement>) => {
        onKeyDown?.(event);
        if (event.defaultPrevented) {
          return;
        }
        if (event.key === "Escape") {
          image.setZoomOpen(false);
          return;
        }
        if (event.key === "Tab") {
          trapOverlayFocus(event, overlayRef.current);
        }
      },
      [image, onKeyDown],
    );

    if (!image.zoomOpen || image.src === undefined || portalContainer === undefined) {
      return null;
    }

    const overlay = renderPrimitive(
      "div",
      {
        ...props,
        children: <img alt={image.name ?? "Image"} data-anvia-image-zoom-img="" src={image.src} />,
        onClick: handleClick,
        onKeyDown: handleKeyDown,
        "aria-modal": props["aria-modal"] ?? true,
        role: props.role ?? "dialog",
        tabIndex: props.tabIndex ?? -1,
        "data-anvia-image-zoom-overlay": "",
      } as PrimitiveProps<"div">,
      composedRef,
    );

    return createPortal(overlay, portalContainer);
  },
);

function isImageAttachment(attachment: UIAttachment): boolean {
  return attachment.type === "image" || attachment.mediaType?.startsWith("image/") === true;
}

function imageSource(attachment: UIAttachment): string | undefined {
  if (!isImageAttachment(attachment)) {
    return attachment.url;
  }
  if (attachment.url !== undefined) {
    return attachment.url;
  }
  if (attachment.data !== undefined && attachment.mediaType !== undefined) {
    return `data:${attachment.mediaType};base64,${attachment.data}`;
  }
  return undefined;
}

async function copyImage(image: ImageContextValue): Promise<void> {
  if (image.src === undefined) {
    throw new Error("Image source is unavailable.");
  }
  const clipboard = globalThis.navigator?.clipboard as
    | (Clipboard & { write?: (items: ClipboardItem[]) => Promise<void> })
    | undefined;
  const ClipboardItemConstructor = globalThis.ClipboardItem;
  if (clipboard?.write === undefined || ClipboardItemConstructor === undefined) {
    throw new Error("Clipboard image copy is unavailable.");
  }
  const blob = await imageBlob(image);
  await clipboard.write([new ClipboardItemConstructor({ [blob.type]: blob })]);
}

async function imageBlob(image: ImageContextValue): Promise<Blob> {
  if (image.attachment.data !== undefined) {
    return base64ToBlob(
      image.attachment.data,
      image.attachment.mediaType ?? image.mediaType ?? "image/png",
    );
  }
  if (image.src === undefined || globalThis.fetch === undefined) {
    throw new Error("Image source is unavailable.");
  }
  const response = await fetch(image.src);
  return response.blob();
}

function base64ToBlob(data: string, mediaType: string): Blob {
  const binary = globalThis.atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new Blob([bytes], { type: mediaType });
}

async function downloadImage(
  image: ImageContextValue,
  filename: string | undefined,
): Promise<void> {
  const document = globalThis.document;
  const url = globalThis.URL;
  if (image.src === undefined || document === undefined || url?.createObjectURL === undefined) {
    return;
  }
  const blobUrl = url.createObjectURL(await imageBlob(image));
  const link = document.createElement("a");
  try {
    link.href = blobUrl;
    link.download = filename ?? image.name ?? defaultImageFilename(image);
    link.rel = "noopener";
    document.body.append(link);
    link.click();
  } finally {
    link.remove();
    url.revokeObjectURL(blobUrl);
  }
}

function defaultImageFilename(image: ImageContextValue): string {
  const extension = image.mediaType?.split("/")[1]?.split(";")[0] ?? "png";
  return `image.${extension}`;
}

function focusOverlay(overlay: HTMLDivElement | null): void {
  if (overlay === null) {
    return;
  }
  const [firstFocusable] = focusableElements(overlay);
  (firstFocusable ?? overlay).focus();
}

function trapOverlayFocus(
  event: KeyboardEvent<HTMLDivElement>,
  overlay: HTMLDivElement | null,
): void {
  if (overlay === null) {
    return;
  }
  const focusable = focusableElements(overlay);
  if (focusable.length === 0) {
    event.preventDefault();
    overlay.focus();
    return;
  }

  const firstFocusable = focusable[0];
  const lastFocusable = focusable[focusable.length - 1];
  const activeElement = globalThis.document?.activeElement;
  if (event.shiftKey && activeElement === firstFocusable) {
    event.preventDefault();
    lastFocusable?.focus();
    return;
  }
  if (!event.shiftKey && activeElement === lastFocusable) {
    event.preventDefault();
    firstFocusable?.focus();
    return;
  }
  if (activeElement instanceof Node && !overlay.contains(activeElement)) {
    event.preventDefault();
    (event.shiftKey ? lastFocusable : firstFocusable)?.focus();
  }
}

function focusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>(
      [
        "a[href]",
        "button:not(:disabled)",
        "input:not(:disabled)",
        "select:not(:disabled)",
        "textarea:not(:disabled)",
        "[tabindex]",
      ].join(","),
    ),
  ).filter((element) => element.tabIndex >= 0 && element.getAttribute("aria-hidden") !== "true");
}

export {
  ImageActions,
  ImageCopy,
  ImageDownload,
  ImageName,
  ImagePreview,
  ImageRoot,
  ImageZoomOverlay,
  ImageZoomTrigger,
};
