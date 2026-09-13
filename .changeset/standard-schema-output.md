---
"@anvia/core": minor
---

Accept any Standard Schema as the `outputSchema` of `generateCompletion` and `streamCompletion`.
Zod schemas keep their existing behavior; Valibot schemas now work end to end when the optional
peer dependency `@valibot/to-json-schema` is installed. Other Standard Schema libraries are
supported when they implement the Standard JSON Schema interface (`~standard.jsonSchema`); vendor
conversion support is resolved by `~standard.vendor`. Schemas without conversion support fail
before any model call with a descriptive error.

Transformed schemas whose validation input and output differ (for example `string -> number`) are
supported. Providers receive the schema's input representation — the raw response is what
`~standard.validate` accepts — while the validated, possibly transformed value becomes the
completion output. Generic and Valibot conversion always describe the input side; Zod conversion
uses the output side only when it describes the same accepted values as the input side (keeping
strict-object refinements such as `additionalProperties: false` for provider strict modes) and
falls back to the input side otherwise, including transformed and piped schemas which previously
failed conversion. Object schema nodes reached through schema positions (properties, items,
combinators, definitions) without an explicit `additionalProperties` are completed with `false`
in every provider payload so payloads remain eligible for provider strict modes such as OpenAI
structured outputs; literal values under `const`, `enum`, `default`, and `examples` are preserved.

Output validation now runs through the schema's `~standard.validate`, so schemas that validate
asynchronously are rejected with a `CompletionStructuredOutputError` in the `schema` phase instead
of being limited to Zod.

Exports `StandardSchemaV1`, `StandardJSONSchemaV1`, and `isStandardSchema` from the root entrypoint.
`streamCompletion` keeps its eager abort, streaming, input, and capability checks; only JSON Schema
conversions that require loading a vendor converter are deferred to the first stream pull.
