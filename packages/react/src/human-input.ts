export function upsertById<TItem extends { id: string }>(items: TItem[], item: TItem): TItem[] {
  const index = items.findIndex((current) => current.id === item.id);
  if (index === -1) return [...items, item];
  const next = [...items];
  next[index] = item;
  return next;
}
