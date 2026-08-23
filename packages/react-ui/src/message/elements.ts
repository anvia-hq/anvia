const messageIds = new WeakMap<HTMLElement, string>();

export function registerMessageElement(element: HTMLElement, messageId: string): void {
  messageIds.set(element, messageId);
}

export function messageElementFromNode(
  node: Node | null,
): { element: HTMLElement; messageId: string } | undefined {
  let element =
    node?.nodeType === Node.ELEMENT_NODE
      ? (node as HTMLElement)
      : (node?.parentElement ?? undefined);

  while (element !== undefined && element !== null) {
    const messageId = messageIds.get(element);
    if (messageId !== undefined) {
      return { element, messageId };
    }
    element = element.parentElement ?? undefined;
  }
  return undefined;
}
