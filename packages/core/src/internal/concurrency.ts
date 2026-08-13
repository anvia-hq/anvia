export async function mapWithConcurrency<Input, Output>(
  inputs: Input[],
  concurrency: number,
  mapper: (input: Input) => Promise<Output>,
): Promise<Output[]> {
  if (!Number.isSafeInteger(concurrency) || concurrency <= 0) {
    throw new RangeError("concurrency must be a positive safe integer.");
  }
  const limit = concurrency;
  const results = new Array<Output>(inputs.length);
  let nextIndex = 0;
  let firstFailure: { error: unknown } | undefined;

  async function worker(): Promise<void> {
    while (firstFailure === undefined && nextIndex < inputs.length) {
      const index = nextIndex;
      nextIndex += 1;
      try {
        results[index] = await mapper(inputs[index] as Input);
      } catch (error) {
        firstFailure ??= { error };
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, inputs.length) }, () => worker()));
  if (firstFailure !== undefined) {
    throw firstFailure.error;
  }
  return results;
}
