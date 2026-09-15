import { PrismaMemoryStore as DelegateMemoryStore } from "./store.js";
import { prisma8Delegates } from "./v8-delegates.js";
import type { PrismaMemoryStoreOptions as LegacyOptions } from "./types.js";

export type PrismaMemoryModelNames = {
  sessions?: string | undefined;
  messages?: string | undefined;
  /** Set to null when failed-run storage is disabled and the model is absent. */
  errors?: string | null | undefined;
};

export type PrismaMemoryStoreOptions = Pick<
  LegacyOptions,
  "scopeKey" | "errorPolicy" | "validateMessages" | "transaction"
> & {
  /** Caller-owned @prisma/orm-postgres client, created from an Anvia-compatible contract. */
  client: object;
  /** PostgreSQL model namespace. Defaults to public. */
  schema?: string | undefined;
  /** Model names within the namespace. Field and relation names must match the contract. */
  models?: PrismaMemoryModelNames | undefined;
};

/** Prisma 8 PostgreSQL memory store. The caller owns connections and migrations. */
export class PrismaMemoryStore extends DelegateMemoryStore {
  constructor(options: PrismaMemoryStoreOptions) {
    super({
      delegates: prisma8Delegates(options),
      scopeKey: options.scopeKey,
      errorPolicy: options.errorPolicy,
      validateMessages: options.validateMessages,
      transaction: options.transaction,
    });
  }
}
