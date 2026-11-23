import { noConditionalObjectSpread } from "./rules/no-conditional-object-spread.mjs";
import { noInlineComments } from "./rules/no-inline-comments.mjs";
import { paddedIf } from "./rules/padded-if.mjs";

export default {
  meta: {
    name: "anvia",
  },
  rules: {
    "no-conditional-object-spread": noConditionalObjectSpread,
    "no-inline-comments": noInlineComments,
    "padded-if": paddedIf,
  },
};
