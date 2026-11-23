export function retainedEventLimit(limit: number | undefined, hook: string): number | undefined {
  if (limit !== undefined && (!Number.isSafeInteger(limit) || limit < 1)) {
    throw new RangeError(`${hook} maxRetainedEvents must be a positive safe integer.`);
  }

  return limit;
}

export function appendRetainedEvent<Event>(
  current: readonly Event[],
  event: Event,
  limit: number | undefined,
): Event[] {
  if (limit === undefined) return [...current, event];

  const next = [...current, event];
  return next.length <= limit ? next : next.slice(next.length - limit);
}
