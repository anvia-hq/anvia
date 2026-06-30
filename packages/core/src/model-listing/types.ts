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
