const LINE_DIRECTIVE_PATTERN =
  /^(?:@ts-(?:expect-error|ignore|nocheck|check)(?:$|\s|:)|\/\s*<(?:reference|amd-module|amd-dependency)\b|(?:oxlint|eslint)-(?:disable|enable)(?:-next-line|-line)?(?:$|\s)|biome-ignore(?:-all)?(?:$|\s)|(?:prettier|oxfmt)-ignore(?:$|\s)|(?:v8|c8|istanbul)\s+ignore\b|@vitest-environment\b|@?vite-ignore\b|SPDX-License-Identifier:)/;

const BLOCK_DIRECTIVE_PATTERN =
  /^(?:(?:oxlint|eslint)-(?:disable|enable)(?:-next-line|-line)?(?:$|\s)|eslint\s|globals?\s|biome-ignore(?:-all)?(?:$|\s)|(?:prettier|oxfmt)-ignore(?:$|\s)|(?:v8|c8|istanbul)\s+ignore\b|[@#]__(?:PURE|NO_SIDE_EFFECTS)__(?:$|\s)|@?vite-ignore\b|webpack(?:Ignore|ChunkName|Mode|Prefetch|Preload)\b|@(?:jsx|jsxImportSource|jsxFrag|jsxRuntime|vitest-environment)\b|SPDX-License-Identifier:)/;

function isJsdocComment(comment) {
  if (comment.type !== "Block") {
    return false;
  }

  return comment.value.length > 1 && /^\*(?:$|\s)/.test(comment.value);
}

function isDirectiveComment(comment) {
  const trimmed = comment.value.trimStart();

  if (comment.type === "Line") {
    return LINE_DIRECTIVE_PATTERN.test(trimmed);
  }

  if (comment.type === "Block") {
    return BLOCK_DIRECTIVE_PATTERN.test(trimmed);
  }

  return false;
}

export const noInlineComments = {
  meta: {
    type: "suggestion",
    docs: {
      description:
        "Disallow inline and implementation comments while allowing standalone JSDoc and tooling directives.",
    },
    schema: [],
    messages: {
      disallowed:
        "Inline comments are not allowed. Use JSDoc (/** ... */) for API/type documentation, or make the code self-explanatory.",
      trailingJsdoc:
        "JSDoc comments must be placed on their own line, not trailing code on the same line.",
    },
  },
  create(context) {
    const { sourceCode } = context;

    return {
      Program() {
        for (const comment of sourceCode.getAllComments()) {
          if (comment.type !== "Line" && comment.type !== "Block") {
            continue;
          }

          if (isDirectiveComment(comment)) {
            continue;
          }

          if (isJsdocComment(comment)) {
            const prevToken = sourceCode.getTokenBefore(comment);

            if (prevToken !== null && prevToken.loc.end.line === comment.loc.start.line) {
              context.report({
                loc: comment.loc,
                messageId: "trailingJsdoc",
              });
            }

            continue;
          }

          context.report({
            loc: comment.loc,
            messageId: "disallowed",
          });
        }
      },
    };
  },
};
