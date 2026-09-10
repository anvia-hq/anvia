export type MaybePromise<T> = T | Promise<T>;

/** Mutable view of a readonly object type, for building values with conditional assignment. */
export type Writable<T> = { -readonly [K in keyof T]: T[K] };

export type DeepReadonly<T> = T extends (...args: never[]) => unknown
  ? T
  : T extends readonly (infer Item)[]
    ? readonly DeepReadonly<Item>[]
    : T extends object
      ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
      : T;
