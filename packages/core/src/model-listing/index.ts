export type ModelId<KnownModel extends string> = KnownModel | (string & {});

export type ListedModel = {
  id: string;
  name?: string;
  description?: string;
  type?: string;
  createdAt?: number;
  ownedBy?: string;
  contextLength?: number;
};

export type ModelList = {
  data: ListedModel[];
};

export interface ModelListingClient {
  listModels(): Promise<ModelList>;
}

type ModelListingErrorOptions = {
  provider?: string | undefined;
  statusCode?: number | undefined;
  cause?: unknown;
};

export class ModelListingError extends Error {
  readonly provider?: string | undefined;
  readonly statusCode?: number | undefined;
  override readonly cause?: unknown;

  constructor(message: string, options: ModelListingErrorOptions = {}) {
    super(message, { cause: options.cause });
    this.name = "ModelListingError";
    this.provider = options.provider;
    this.statusCode = options.statusCode;
    this.cause = options.cause;
  }
}
