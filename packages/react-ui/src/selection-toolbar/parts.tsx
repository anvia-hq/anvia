import {
  type CSSProperties,
  forwardRef,
  type MouseEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { createPortal } from "react-dom";

import {
  InternalSelectionToolbarProvider,
  type SelectionToolbarContextValue,
  type SelectionToolbarSelection,
  useSelectionToolbar,
} from "../contexts";
import { type PrimitiveProps, renderPrimitive } from "../primitives";

type SelectionToolbarRootProps = Omit<PrimitiveProps<"div">, "children"> & {
  children?: ReactNode;
  container?: Element | DocumentFragment;
  onQuote?: (selection: SelectionToolbarSelection) => void;
  onSelectionChange?: (selection: SelectionToolbarSelection | undefined) => void;
};

const SelectionToolbarRoot = forwardRef<HTMLDivElement, SelectionToolbarRootProps>(
  function SelectionToolbarRoot(
    { children, container, onQuote, onSelectionChange, style, ...props },
    ref,
  ) {
    const [selection, setSelectionState] = useState<SelectionToolbarSelection | undefined>();
    const portalContainer = container ?? globalThis.document?.body;

    const setSelection = useCallback(
      (nextSelection: SelectionToolbarSelection | undefined) => {
        setSelectionState((currentSelection) => {
          if (sameSelection(currentSelection, nextSelection)) {
            return currentSelection;
          }
          onSelectionChange?.(nextSelection);
          return nextSelection;
        });
      },
      [onSelectionChange],
    );

    const clear = useCallback(() => {
      globalThis.document?.getSelection()?.removeAllRanges();
      setSelection(undefined);
    }, [setSelection]);

    const copy = useCallback(async () => {
      if (selection === undefined) {
        return;
      }
      await globalThis.navigator?.clipboard?.writeText(selection.text);
      clear();
    }, [clear, selection]);

    const quote = useCallback(() => {
      if (selection === undefined) {
        return;
      }
      onQuote?.(selection);
      clear();
    }, [clear, onQuote, selection]);

    const value = useMemo<SelectionToolbarContextValue>(() => {
      const context: SelectionToolbarContextValue = { quote, copy, clear };
      if (selection !== undefined) context.selection = selection;
      return context;
    }, [clear, copy, quote, selection]);

    useEffect(() => {
      const document = globalThis.document;
      if (document === undefined) {
        return;
      }

      const handleSelectionChange = () => {
        setSelection(selectionFromDocument(document));
      };

      document.addEventListener("selectionchange", handleSelectionChange);
      document.addEventListener("mouseup", handleSelectionChange);
      document.addEventListener("keyup", handleSelectionChange);
      document.addEventListener("scroll", handleSelectionChange, true);
      return () => {
        document.removeEventListener("selectionchange", handleSelectionChange);
        document.removeEventListener("mouseup", handleSelectionChange);
        document.removeEventListener("keyup", handleSelectionChange);
        document.removeEventListener("scroll", handleSelectionChange, true);
      };
    }, [setSelection]);

    if (selection === undefined || portalContainer === undefined) {
      return null;
    }

    const toolbarStyle: CSSProperties = {
      position: "fixed",
      top: selection.rect.top,
      left: selection.rect.left + selection.rect.width / 2,
      transform: "translate(-50%, calc(-100% - 8px))",
      ...style,
    };

    const toolbar = (
      <InternalSelectionToolbarProvider value={value}>
        {renderPrimitive(
          "div",
          {
            ...props,
            children: children ?? (
              <>
                <SelectionToolbarQuote />
                <SelectionToolbarCopy />
              </>
            ),
            style: toolbarStyle,
            "data-anvia-selection-toolbar": "",
            "data-message-id": selection.messageId,
            role: props.role ?? "toolbar",
          } as PrimitiveProps<"div">,
          ref,
        )}
      </InternalSelectionToolbarProvider>
    );

    return createPortal(toolbar, portalContainer);
  },
);

const SelectionToolbarQuote = forwardRef<HTMLButtonElement, PrimitiveProps<"button">>(
  function SelectionToolbarQuote({ onClick, ...props }, ref) {
    const { disabled, handleClick } = useSelectionToolbarAction("quote", props.disabled, onClick);

    return renderPrimitive(
      "button",
      {
        ...props,
        children: props.children ?? "Quote",
        disabled,
        onClick: handleClick,
        type: props.type ?? "button",
        "data-anvia-selection-quote": "",
        "data-state": disabled ? "disabled" : "enabled",
      } as PrimitiveProps<"button">,
      ref,
    );
  },
);

const SelectionToolbarCopy = forwardRef<HTMLButtonElement, PrimitiveProps<"button">>(
  function SelectionToolbarCopy({ onClick, ...props }, ref) {
    const { disabled, handleClick } = useSelectionToolbarAction("copy", props.disabled, onClick);

    return renderPrimitive(
      "button",
      {
        ...props,
        children: props.children ?? "Copy",
        disabled,
        onClick: handleClick,
        type: props.type ?? "button",
        "data-anvia-selection-copy": "",
        "data-state": disabled ? "disabled" : "enabled",
      } as PrimitiveProps<"button">,
      ref,
    );
  },
);

type SelectionToolbarAction = "copy" | "quote";

function useSelectionToolbarAction(
  actionName: SelectionToolbarAction,
  disabledProp: boolean | undefined,
  onClick: ((event: MouseEvent<HTMLButtonElement>) => void) | undefined,
): {
  disabled: boolean;
  handleClick(event: MouseEvent<HTMLButtonElement>): void;
} {
  const toolbar = useSelectionToolbar();
  const disabled = disabledProp ?? toolbar.selection === undefined;
  const action = toolbar[actionName];
  const handleClick = useCallback(
    (event: MouseEvent<HTMLButtonElement>) => {
      onClick?.(event);
      if (event.defaultPrevented || disabled) {
        return;
      }
      void action();
    },
    [action, disabled, onClick],
  );
  return { disabled, handleClick };
}

function selectionFromDocument(document: Document): SelectionToolbarSelection | undefined {
  const selection = document.getSelection();
  if (selection === null || selection.rangeCount === 0) {
    return undefined;
  }
  const text = selection.toString();
  if (text.trim().length === 0) {
    return undefined;
  }

  const anchorMessage = messageElementFromNode(selection.anchorNode);
  const focusMessage = messageElementFromNode(selection.focusNode);
  if (anchorMessage === undefined || focusMessage === undefined || anchorMessage !== focusMessage) {
    return undefined;
  }

  const messageId = anchorMessage.getAttribute("data-anvia-message-id");
  if (messageId === null || messageId.length === 0) {
    return undefined;
  }

  const range = selection.getRangeAt(0);
  return {
    text,
    messageId,
    rect: selectionRect(range),
  };
}

function messageElementFromNode(node: Node | null): HTMLElement | undefined {
  if (node === null) {
    return undefined;
  }
  const element = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
  return element?.closest<HTMLElement>("[data-anvia-message-id]") ?? undefined;
}

function selectionRect(range: Range): DOMRect {
  const rangeWithRect = range as Range & {
    getBoundingClientRect?: () => DOMRect;
  };
  const rect = rangeWithRect.getBoundingClientRect?.();
  if (rect !== undefined && (rect.width > 0 || rect.height > 0)) {
    return rect;
  }
  const firstRect = range.getClientRects().item(0);
  if (firstRect !== null) {
    return firstRect;
  }
  const DOMRectConstructor = globalThis.DOMRect;
  if (DOMRectConstructor !== undefined) {
    return new DOMRectConstructor(0, 0, 0, 0);
  }
  return {
    bottom: 0,
    height: 0,
    left: 0,
    right: 0,
    top: 0,
    width: 0,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  } as DOMRect;
}

function sameSelection(
  currentSelection: SelectionToolbarSelection | undefined,
  nextSelection: SelectionToolbarSelection | undefined,
): boolean {
  if (currentSelection === undefined || nextSelection === undefined) {
    return currentSelection === nextSelection;
  }
  return (
    currentSelection.text === nextSelection.text &&
    currentSelection.messageId === nextSelection.messageId &&
    currentSelection.rect.left === nextSelection.rect.left &&
    currentSelection.rect.top === nextSelection.rect.top &&
    currentSelection.rect.width === nextSelection.rect.width &&
    currentSelection.rect.height === nextSelection.rect.height
  );
}

export { SelectionToolbarCopy, SelectionToolbarQuote, SelectionToolbarRoot };
