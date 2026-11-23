function hasBlankLineBetween(first, second) {
  return second.loc.start.line - first.loc.end.line >= 2;
}

function checkStatementList(context, statements) {
  if (statements.length < 2) {
    return;
  }

  const { sourceCode } = context;
  const newline = sourceCode.text.includes("\r\n") ? "\r\n" : "\n";

  for (let index = 0; index < statements.length - 1; index += 1) {
    const prev = statements[index];
    const next = statements[index + 1];

    if (prev.type === "EmptyStatement" || next.type === "EmptyStatement") {
      continue;
    }

    if (prev.type !== "IfStatement" && next.type !== "IfStatement") {
      continue;
    }

    const prevLastToken = sourceCode.getLastToken(prev);
    const nextFirstToken = sourceCode.getFirstToken(next);

    if (prevLastToken === null || nextFirstToken === null) {
      continue;
    }

    const comments = sourceCode.getCommentsAfter(prevLastToken);
    let anchorPrev = prevLastToken;
    let firstRemainingCommentIndex = 0;

    // Attach trailing same-line comments to the preceding statement unless both
    // statements share a single line.
    if (prevLastToken.loc.end.line < nextFirstToken.loc.start.line) {
      while (firstRemainingCommentIndex < comments.length) {
        const comment = comments[firstRemainingCommentIndex];

        if (
          comment.loc.start.line === anchorPrev.loc.end.line &&
          comment.loc.end.line < nextFirstToken.loc.start.line
        ) {
          anchorPrev = comment;
          firstRemainingCommentIndex += 1;
        } else {
          break;
        }
      }
    }

    const sequence = [anchorPrev, ...comments.slice(firstRemainingCommentIndex), nextFirstToken];
    let padded = false;

    for (let itemIndex = 0; itemIndex < sequence.length - 1; itemIndex += 1) {
      if (hasBlankLineBetween(sequence[itemIndex], sequence[itemIndex + 1])) {
        padded = true;
        break;
      }
    }

    if (padded) {
      continue;
    }

    const messageId = next.type === "IfStatement" ? "expectedBefore" : "expectedAfter";
    const nextItem = sequence[1];

    context.report({
      loc: nextFirstToken.loc,
      messageId,
      fix(fixer) {
        if (nextItem.loc.start.line === anchorPrev.loc.end.line) {
          return fixer.replaceTextRange(
            [anchorPrev.range[1], nextItem.range[0]],
            `${newline}${newline}`,
          );
        }

        return fixer.insertTextAfter(anchorPrev, newline);
      },
    });
  }
}

export const paddedIf = {
  meta: {
    type: "layout",
    fixable: "whitespace",
    docs: {
      description: "Require blank lines before and after if statements.",
    },
    schema: [],
    messages: {
      expectedBefore: "Expected a blank line before this if statement.",
      expectedAfter: "Expected a blank line after the preceding if statement.",
    },
  },
  create(context) {
    return {
      Program(node) {
        checkStatementList(context, node.body);
      },
      BlockStatement(node) {
        checkStatementList(context, node.body);
      },
      StaticBlock(node) {
        checkStatementList(context, node.body);
      },
      SwitchCase(node) {
        checkStatementList(context, node.consequent);
      },
      TSModuleBlock(node) {
        checkStatementList(context, node.body);
      },
    };
  },
};
