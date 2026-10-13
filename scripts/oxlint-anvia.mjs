const noConditionalObjectSpread = {
  meta: {
    type: "suggestion",
    docs: {
      description: "Prefer explicit property assignments over conditional object spreads.",
    },
    schema: [],
    messages: {
      conditional:
        "Use an explicit if statement and property assignments instead of a conditional object spread.",
    },
  },
  create(context) {
    return {
      SpreadElement(node) {
        if (node.parent.type !== "ObjectExpression") {
          return;
        }

        let argument = node.argument;
        // TypeScript wrappers must not hide the expression being spread.
        while (
          argument.type === "ParenthesizedExpression" ||
          argument.type === "TSAsExpression" ||
          argument.type === "TSTypeAssertion" ||
          argument.type === "TSNonNullExpression" ||
          argument.type === "TSSatisfiesExpression"
        ) {
          argument = argument.expression;
        }

        if (
          argument.type === "ConditionalExpression" ||
          (argument.type === "LogicalExpression" &&
            (argument.operator === "&&" || argument.operator === "||"))
        ) {
          context.report({ node, messageId: "conditional" });
        }
      },
    };
  },
};

export default {
  meta: { name: "anvia" },
  rules: { "no-conditional-object-spread": noConditionalObjectSpread },
};
