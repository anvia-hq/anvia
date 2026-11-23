export type JsonPrimitive = string | number | boolean | null;
/** Any JSON-compatible value: primitives, objects, or readonly arrays of JSON values. */
export type JsonValue = JsonPrimitive | JsonObject | readonly JsonValue[];
export type JsonObject = { [key: string]: JsonValue };
