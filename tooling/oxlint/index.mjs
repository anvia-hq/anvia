import { noConditionalObjectSpread } from "./rules/no-conditional-object-spread.mjs";
import { paddedIf } from "./rules/padded-if.mjs";

export default {
  meta: {
    name: "anvia",
  },
  rules: {
    "no-conditional-object-spread": noConditionalObjectSpread,
    "padded-if": paddedIf,
  },
};
