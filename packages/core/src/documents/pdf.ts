export type PdfTextPage = Readonly<{
  pageNumber: number;
  text: string;
}>;

export type ExtractPdfTextOptions = Readonly<{
  data: Uint8Array;
  abortSignal?: AbortSignal;
}>;

export type ExtractPdfTextResult = Readonly<{
  pages: readonly PdfTextPage[];
}>;

export async function extractPdfText(
  options: ExtractPdfTextOptions,
): Promise<ExtractPdfTextResult> {
  if (typeof options !== "object" || options === null) {
    throw new TypeError("extractPdfText options must be an object");
  }
  if (!(options.data instanceof Uint8Array)) {
    throw new TypeError("extractPdfText data must be a Uint8Array");
  }
  if (options.abortSignal !== undefined && !isAbortSignal(options.abortSignal)) {
    throw new TypeError("extractPdfText abortSignal must be an AbortSignal");
  }

  const { abortSignal } = options;
  abortSignal?.throwIfAborted();
  const data = new Uint8Array(options.data);
  const pdfjs = await loadPdfjs();
  abortSignal?.throwIfAborted();

  const loadingTask = pdfjs.getDocument({ data });
  let destroyPromise: Promise<void> | undefined;
  const destroy = (): Promise<void> => {
    destroyPromise ??= loadingTask.destroy();
    return destroyPromise;
  };
  const abort = createAbortPromise(abortSignal, destroy);

  return runWithCleanup(
    async () => {
      const document = await abort.wait(loadingTask.promise);
      const pages: PdfTextPage[] = [];
      for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
        abortSignal?.throwIfAborted();
        const page = await abort.wait(document.getPage(pageNumber));
        const content = await abort.wait(page.getTextContent());
        pages.push({ pageNumber, text: extractPageText(content.items) });
      }
      return { pages };
    },
    async () => {
      abort.dispose();
      await destroy();
    },
  );
}

async function loadPdfjs(): Promise<typeof import("pdfjs-dist/legacy/build/pdf.mjs")> {
  try {
    return await import("pdfjs-dist/legacy/build/pdf.mjs");
  } catch (cause) {
    if (!isMissingPdfjsDependency(cause)) {
      throw cause;
    }
    throw new Error(
      'PDF extraction requires the optional "pdfjs-dist" package. Install it in your application to use extractPdfText().',
      { cause },
    );
  }
}

function isMissingPdfjsDependency(error: unknown): boolean {
  const seen = new Set<unknown>();
  let current = error;
  while (current instanceof Error && !seen.has(current)) {
    seen.add(current);
    if (
      current.message.includes("pdfjs-dist") &&
      "code" in current &&
      current.code === "ERR_MODULE_NOT_FOUND"
    ) {
      return true;
    }
    current = "cause" in current ? current.cause : undefined;
  }
  return false;
}

async function runWithCleanup<Result>(
  operation: () => Promise<Result>,
  cleanup: () => Promise<void>,
): Promise<Result> {
  let outcome: { ok: true; value: Result } | { ok: false; error: unknown };
  try {
    outcome = { ok: true, value: await operation() };
  } catch (error) {
    outcome = { ok: false, error };
  }

  let cleanupError: unknown;
  let cleanupFailed = false;
  try {
    await cleanup();
  } catch (error) {
    cleanupFailed = true;
    cleanupError = error;
  }

  if (!outcome.ok) {
    if (cleanupFailed) {
      throw new AggregateError(
        [outcome.error, cleanupError],
        "PDF extraction and cleanup both failed",
        { cause: outcome.error },
      );
    }
    throw outcome.error;
  }
  if (cleanupFailed) {
    throw cleanupError;
  }
  return outcome.value;
}

function isAbortSignal(value: unknown): value is AbortSignal {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Partial<AbortSignal>;
  return (
    typeof candidate.aborted === "boolean" &&
    typeof candidate.addEventListener === "function" &&
    typeof candidate.removeEventListener === "function" &&
    typeof candidate.throwIfAborted === "function"
  );
}

function extractPageText(items: readonly unknown[]): string {
  let text = "";
  for (const item of items) {
    if (typeof item !== "object" || item === null) {
      throw new TypeError("PDF text content contains a malformed item");
    }
    if (!("str" in item)) {
      if (
        "type" in item &&
        (item.type === "beginMarkedContent" ||
          item.type === "beginMarkedContentProps" ||
          item.type === "endMarkedContent")
      ) {
        continue;
      }
      throw new TypeError("PDF text content contains an unknown non-text item");
    }
    if (typeof item.str !== "string") {
      throw new TypeError("PDF text content item str must be a string");
    }
    if (!("hasEOL" in item) || typeof item.hasEOL !== "boolean") {
      throw new TypeError("PDF text content item hasEOL must be a boolean");
    }
    text += item.str;
    if (item.hasEOL) {
      text += "\n";
    }
  }
  return text;
}

function createAbortPromise(
  abortSignal: AbortSignal | undefined,
  destroy: () => Promise<void>,
): {
  wait<T>(promise: Promise<T>): Promise<T>;
  dispose(): void;
} {
  if (abortSignal === undefined) {
    return {
      wait: (promise) => promise,
      dispose: () => undefined,
    };
  }

  let rejectAbort: ((reason?: unknown) => void) | undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    rejectAbort = reject;
  });
  const onAbort = () => {
    void destroy();
    rejectAbort?.(
      abortSignal.reason ?? new DOMException("The operation was aborted", "AbortError"),
    );
  };
  abortSignal.addEventListener("abort", onAbort, { once: true });
  if (abortSignal.aborted) {
    onAbort();
  }

  return {
    wait: (promise) => Promise.race([promise, aborted]),
    dispose: () => abortSignal.removeEventListener("abort", onAbort),
  };
}
