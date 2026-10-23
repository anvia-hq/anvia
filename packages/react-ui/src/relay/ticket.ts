/** What a viewer's `ticket` prop can be: a ticket, or a function returning one per connection. */
export type TicketSource = string | (() => string | Promise<string>);

/**
 * Turn the latest `ticket` prop into the per-attempt function a connection wants. The prop is read
 * on every attempt, so a function is called afresh each time: tickets are single use.
 */
export function resolveTicket(
  read: () => TicketSource | undefined,
): (() => string | Promise<string>) | undefined {
  if (read() === undefined) return undefined;
  return () => {
    const ticket = read();
    return typeof ticket === "function" ? ticket() : (ticket as string);
  };
}
