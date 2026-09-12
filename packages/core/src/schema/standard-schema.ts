// Vendor of the Standard Schema v1 specification interfaces
// (https://standardschema.dev, MIT license). The spec recommends that
// consumers copy the interfaces instead of taking a runtime dependency, so
// only the type surface and small validation helpers live here.

/** The Standard Typed interface. This is a base type extended by other specs. */
export interface StandardTypedV1<Input = unknown, Output = Input> {
  /** The Standard properties. */
  readonly "~standard": StandardTypedV1.Props<Input, Output>;
}

export declare namespace StandardTypedV1 {
  /** The Standard Typed properties interface. */
  export interface Props<Input = unknown, Output = Input> {
    /** The version number of the standard. */
    readonly version: 1;
    /** The vendor name of the schema library. */
    readonly vendor: string;
    /** Inferred types associated with the schema. */
    readonly types?: Types<Input, Output> | undefined;
  }

  /** The Standard Typed types interface. */
  export interface Types<Input = unknown, Output = Input> {
    /** The input type of the schema. */
    readonly input: Input;
    /** The output type of the schema. */
    readonly output: Output;
  }

  /** Infers the input type of a Standard Typed. */
  export type InferInput<Schema extends StandardTypedV1> = NonNullable<
    Schema["~standard"]["types"]
  >["input"];

  /** Infers the output type of a Standard Typed. */
  export type InferOutput<Schema extends StandardTypedV1> = NonNullable<
    Schema["~standard"]["types"]
  >["output"];
}

/** The Standard Schema interface for schemas that validate data. */
export interface StandardSchemaV1<Input = unknown, Output = Input> extends StandardTypedV1<
  Input,
  Output
> {
  /** The Standard Schema properties. */
  readonly "~standard": StandardSchemaV1.Props<Input, Output>;
}

export declare namespace StandardSchemaV1 {
  /** The Standard Schema properties interface. */
  export interface Props<Input = unknown, Output = Input> extends StandardTypedV1.Props<
    Input,
    Output
  > {
    /** Validates unknown input values. */
    readonly validate: (
      value: unknown,
      options?: StandardSchemaV1.Options | undefined,
    ) => StandardSchemaV1.Result<Output> | Promise<StandardSchemaV1.Result<Output>>;
  }

  /** The result interface of the validate function. */
  export type Result<Output> =
    | StandardSchemaV1.SuccessResult<Output>
    | StandardSchemaV1.FailureResult;

  /** The result interface if validation succeeds. */
  export interface SuccessResult<Output> {
    /** The typed output value. */
    readonly value: Output;
    /** A falsy value for `issues` indicates success. */
    readonly issues?: undefined;
  }

  /** The options interface of the validate function. */
  export interface Options {
    /** Explicit support for additional vendor-specific parameters, if needed. */
    readonly libraryOptions?: Record<string, unknown> | undefined;
  }

  /** The result interface if validation fails. */
  export interface FailureResult {
    /** The issues of failed validation. */
    readonly issues: ReadonlyArray<StandardSchemaV1.Issue>;
  }

  /** The issue interface of the failure output. */
  export interface Issue {
    /** The error message of the issue. */
    readonly message: string;
    /** The path of the issue, if any. */
    readonly path?: ReadonlyArray<PropertyKey | StandardSchemaV1.PathSegment> | undefined;
  }

  /** The path segment interface of the issue path. */
  export interface PathSegment {
    /** The key representing a path segment. */
    readonly key: PropertyKey;
  }

  /** The Standard types interface. */
  export interface Types<Input = unknown, Output = Input> extends StandardTypedV1.Types<
    Input,
    Output
  > {}

  /** Infers the input type of a Standard Schema. */
  export type InferInput<Schema extends StandardTypedV1> = StandardTypedV1.InferInput<Schema>;

  /** Infers the output type of a Standard Schema. */
  export type InferOutput<Schema extends StandardTypedV1> = StandardTypedV1.InferOutput<Schema>;
}

/**
 * The Standard JSON Schema interface for entities that can convert themselves
 * to JSON Schema. Schema libraries may expose it alongside
 * {@link StandardSchemaV1} on the same `"~standard"` property bag.
 */
export interface StandardJSONSchemaV1<Input = unknown, Output = Input> extends StandardTypedV1<
  Input,
  Output
> {
  /** The Standard JSON Schema properties. */
  readonly "~standard": StandardJSONSchemaV1.Props<Input, Output>;
}

export declare namespace StandardJSONSchemaV1 {
  /** The Standard JSON Schema properties interface. */
  export interface Props<Input = unknown, Output = Input> extends StandardTypedV1.Props<
    Input,
    Output
  > {
    /** Methods for generating the input/output JSON Schema. */
    readonly jsonSchema: StandardJSONSchemaV1.Converter;
  }

  /** The Standard JSON Schema converter interface. */
  export interface Converter {
    /** Converts the input type to JSON Schema. May throw if conversion is not supported. */
    readonly input: (options: StandardJSONSchemaV1.Options) => Record<string, unknown>;
    /** Converts the output type to JSON Schema. May throw if conversion is not supported. */
    readonly output: (options: StandardJSONSchemaV1.Options) => Record<string, unknown>;
  }

  /** The options for the input/output methods. */
  export interface Options {
    /** The target version of the generated JSON Schema. */
    readonly target: StandardJSONSchemaV1.Target;

    /** Explicit support for additional vendor-specific parameters, if needed. */
    readonly libraryOptions?: Record<string, unknown> | undefined;
  }

  /** The target version of the generated JSON Schema. */
  export type Target =
    | "draft-2020-12"
    | "draft-07"
    | "openapi-3.0"
    // Accepts any string for future targets while preserving autocomplete.
    | ({} & string);

  /** The Standard types interface. */
  export interface Types<Input = unknown, Output = Input> extends StandardTypedV1.Types<
    Input,
    Output
  > {}
}

/** The result of a synchronous Standard Schema validation. */
export type StandardSchemaValidation<Output> =
  | { readonly success: true; readonly value: Output }
  | { readonly success: false; readonly issues: ReadonlyArray<StandardSchemaV1.Issue> };

/** Checks whether a value looks like a Standard Schema. */
export function isStandardSchema(value: unknown): value is StandardSchemaV1 {
  return (
    typeof value === "object" &&
    value !== null &&
    "~standard" in value &&
    typeof (value as StandardSchemaV1)["~standard"] === "object" &&
    (value as StandardSchemaV1)["~standard"] !== null &&
    typeof (value as StandardSchemaV1)["~standard"].validate === "function"
  );
}

/**
 * Validates a value with a Standard Schema synchronously. Schema libraries
 * whose `validate` returns a promise (asynchronous schemas) are rejected;
 * structured completion output must be validated synchronously.
 */
export function validateStandardSchema<Output>(
  schema: StandardSchemaV1<unknown, Output>,
  value: unknown,
): StandardSchemaValidation<Output> {
  const result = schema["~standard"].validate(value);
  if (typeof (result as { then?: unknown }).then === "function") {
    throw new TypeError(
      "The structured output schema validated asynchronously. Asynchronous schemas are not supported for structured completion output.",
    );
  }
  const settled = result as StandardSchemaV1.Result<Output>;
  if (settled.issues === undefined) {
    return { success: true, value: settled.value };
  }
  return { success: false, issues: settled.issues };
}

/** Joins Standard Schema issues into a single human-readable message. */
export function formatStandardSchemaIssues(issues: ReadonlyArray<StandardSchemaV1.Issue>): string {
  return issues
    .map((issue) => {
      const path = (issue.path ?? [])
        .map((segment) =>
          typeof segment === "object" && segment !== null && "key" in segment
            ? segment.key
            : segment,
        )
        .map((key) => (typeof key === "symbol" ? key.toString() : String(key)))
        .join(".");
      return path.length > 0 ? `${path}: ${issue.message}` : issue.message;
    })
    .join("; ");
}
