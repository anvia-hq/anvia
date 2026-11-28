import { createTool, createToolkit, type Toolkit, type ToolkitOptions } from "@anvia/core/tool";
import { z } from "zod";

export type MathToolName = "calculate";

export type MathOptions = ToolkitOptions<MathToolName> & {
  /** Maximum expression length in characters. Default 500. */
  maxExpressionLength?: number | undefined;
  /** Maximum parenthesis/function nesting depth. Default 64. */
  maxDepth?: number | undefined;
};

const DEFAULT_INSTRUCTIONS =
  "Use calculate to evaluate arithmetic and mathematical expressions accurately instead of estimating by hand.";

type Token =
  | { type: "number"; value: number }
  | { type: "ident"; value: string }
  | { type: "op"; value: "+" | "-" | "*" | "/" | "%" | "^" }
  | { type: "lparen" }
  | { type: "rparen" }
  | { type: "comma" };

const CONSTANTS = new Map<string, number>([
  ["pi", Math.PI],
  ["e", Math.E],
]);

const FUNCTIONS = new Map<string, (args: readonly number[]) => number>([
  ["abs", expectUnary(Math.abs, "abs")],
  ["round", expectUnary(Math.round, "round")],
  ["floor", expectUnary(Math.floor, "floor")],
  ["ceil", expectUnary(Math.ceil, "ceil")],
  ["trunc", expectUnary(Math.trunc, "trunc")],
  ["sign", expectUnary(Math.sign, "sign")],
  [
    "sqrt",
    expectUnary((x) => {
      if (x < 0) throw new RangeError("sqrt requires a non-negative argument.");

      return Math.sqrt(x);
    }, "sqrt"),
  ],
  ["cbrt", expectUnary(Math.cbrt, "cbrt")],
  ["exp", expectUnary(Math.exp, "exp")],
  [
    "log",
    expectUnary((x) => {
      if (x <= 0) throw new RangeError("log requires a positive argument.");

      return Math.log(x);
    }, "log"),
  ],
  [
    "log10",
    expectUnary((x) => {
      if (x <= 0) throw new RangeError("log10 requires a positive argument.");

      return Math.log10(x);
    }, "log10"),
  ],
  [
    "log2",
    expectUnary((x) => {
      if (x <= 0) throw new RangeError("log2 requires a positive argument.");

      return Math.log2(x);
    }, "log2"),
  ],
  ["sin", expectUnary(Math.sin, "sin")],
  ["cos", expectUnary(Math.cos, "cos")],
  ["tan", expectUnary(Math.tan, "tan")],
  [
    "pow",
    (args) => {
      if (args.length !== 2) throw new Error("pow requires exactly 2 arguments.");

      return args[0]! ** args[1]!;
    },
  ],
  [
    "min",
    (args) => {
      if (args.length === 0) throw new Error("min requires at least 1 argument.");

      let result = args[0]!;

      for (let i = 1; i < args.length; i += 1) {
        if (args[i]! < result) result = args[i]!;
      }

      return result;
    },
  ],
  [
    "max",
    (args) => {
      if (args.length === 0) throw new Error("max requires at least 1 argument.");

      let result = args[0]!;

      for (let i = 1; i < args.length; i += 1) {
        if (args[i]! > result) result = args[i]!;
      }

      return result;
    },
  ],
]);

export function math(options: MathOptions = {}): Toolkit {
  const maxExpressionLength = options.maxExpressionLength ?? 500;
  const maxDepth = options.maxDepth ?? 64;
  validateMathBounds(maxExpressionLength, maxDepth);

  const calculateTool = createTool({
    name: "calculate",
    description:
      "Evaluate a mathematical expression safely (supports +, -, *, /, %, ^, parentheses, pi, e, and standard math functions like sqrt, abs, round, min, max, pow, log).",
    inputSchema: z.object({
      expression: z.string().min(1).describe("Mathematical expression to evaluate."),
      precision: z
        .number()
        .int()
        .min(0)
        .max(15)
        .optional()
        .describe("Optional decimal places to round the result to."),
    }),
    handler(args) {
      const value = evaluateMathExpression(args.expression, { maxExpressionLength, maxDepth });
      const rawRounded =
        args.precision === undefined ? value : Number(value.toFixed(args.precision));
      const rounded = Object.is(rawRounded, -0) ? 0 : rawRounded;
      return {
        expression: args.expression.trim(),
        result: rounded,
      };
    },
  });

  const toolkitOptions: ToolkitOptions<MathToolName> = {
    instructions: options.instructions ?? DEFAULT_INSTRUCTIONS,
  };

  if (options.include !== undefined) toolkitOptions.include = options.include;

  if (options.exclude !== undefined) toolkitOptions.exclude = options.exclude;

  if (options.prefix !== undefined) toolkitOptions.prefix = options.prefix;

  if (options.requiresApproval !== undefined) {
    toolkitOptions.requiresApproval = options.requiresApproval;
  }

  if (options.timeoutMs !== undefined) toolkitOptions.timeoutMs = options.timeoutMs;

  return createToolkit(
    {
      name: "math",
      tools: [calculateTool],
    },
    toolkitOptions,
  );
}

export function evaluateMathExpression(
  expression: string,
  options: { maxExpressionLength?: number | undefined; maxDepth?: number | undefined } = {},
): number {
  const maxExpressionLength = options.maxExpressionLength ?? 500;
  const maxDepth = options.maxDepth ?? 64;
  validateMathBounds(maxExpressionLength, maxDepth);

  const trimmed = expression.trim();

  if (trimmed.length === 0) {
    throw new Error("Math expression must not be empty.");
  }

  if (trimmed.length > maxExpressionLength) {
    throw new RangeError(`Math expression exceeds maximum length of ${maxExpressionLength} chars.`);
  }

  const tokens = tokenize(trimmed);
  const parser = new ExpressionParser(tokens, maxDepth);
  const result = parser.parse();

  if (!Number.isFinite(result)) {
    throw new RangeError("Math expression produced a non-finite result.");
  }

  return Object.is(result, -0) ? 0 : result;
}

function validateMathBounds(maxExpressionLength: number, maxDepth: number): void {
  if (!Number.isSafeInteger(maxExpressionLength) || maxExpressionLength <= 0) {
    throw new RangeError("math maxExpressionLength must be a positive safe integer.");
  }

  if (!Number.isSafeInteger(maxDepth) || maxDepth <= 0) {
    throw new RangeError("math maxDepth must be a positive safe integer.");
  }
}

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;

  while (index < input.length) {
    const ch = input[index]!;

    if (/\s/.test(ch)) {
      index += 1;
      continue;
    }

    if (ch === "(") {
      tokens.push({ type: "lparen" });
      index += 1;
      continue;
    }

    if (ch === ")") {
      tokens.push({ type: "rparen" });
      index += 1;
      continue;
    }

    if (ch === ",") {
      tokens.push({ type: "comma" });
      index += 1;
      continue;
    }

    if (ch === "+" || ch === "-" || ch === "*" || ch === "/" || ch === "%" || ch === "^") {
      tokens.push({ type: "op", value: ch });
      index += 1;
      continue;
    }

    if (/[0-9.]/.test(ch)) {
      const start = index;
      let sawDot = false;

      while (index < input.length) {
        const c = input[index]!;

        if (c >= "0" && c <= "9") {
          index += 1;
          continue;
        }

        if (c === "." && !sawDot) {
          sawDot = true;
          index += 1;
          continue;
        }

        break;
      }

      if (index < input.length && (input[index] === "e" || input[index] === "E")) {
        const expIndex = index;
        index += 1;

        if (index < input.length && (input[index] === "+" || input[index] === "-")) {
          index += 1;
        }

        const expDigitsStart = index;
        while (index < input.length && input[index]! >= "0" && input[index]! <= "9") {
          index += 1;
        }

        if (index === expDigitsStart) {
          throw new SyntaxError(`Invalid exponent in number at position ${expIndex}.`);
        }
      }

      const rawNumber = input.slice(start, index);
      const parsed = Number(rawNumber);

      if (!Number.isFinite(parsed) || rawNumber === ".") {
        throw new SyntaxError(`Invalid number "${rawNumber}" at position ${start}.`);
      }

      tokens.push({ type: "number", value: parsed });
      continue;
    }

    if (/[a-zA-Z_]/.test(ch)) {
      const start = index;
      while (index < input.length && /[a-zA-Z0-9_]/.test(input[index]!)) {
        index += 1;
      }

      tokens.push({ type: "ident", value: input.slice(start, index).toLowerCase() });
      continue;
    }

    throw new SyntaxError(`Unexpected character "${ch}" at position ${index}.`);
  }

  return tokens;
}

class ExpressionParser {
  private index = 0;
  private depth = 0;

  constructor(
    private readonly tokens: readonly Token[],
    private readonly maxDepth: number,
  ) {}

  parse(): number {
    const value = this.parseAddSub();

    if (this.index < this.tokens.length) {
      throw new SyntaxError("Unexpected trailing tokens in math expression.");
    }

    return value;
  }

  private peek(): Token | undefined {
    return this.tokens[this.index];
  }

  private consume(): Token {
    const token = this.tokens[this.index];

    if (token === undefined) {
      throw new SyntaxError("Unexpected end of math expression.");
    }

    this.index += 1;
    return token;
  }

  private enterDepth(): void {
    this.depth += 1;

    if (this.depth > this.maxDepth) {
      throw new RangeError(`Math expression exceeds maximum nesting depth of ${this.maxDepth}.`);
    }
  }

  private leaveDepth(): void {
    this.depth -= 1;
  }

  private parseAddSub(): number {
    let left = this.parseMulDiv();

    while (true) {
      const next = this.peek();

      if (next?.type !== "op" || (next.value !== "+" && next.value !== "-")) {
        break;
      }

      this.consume();
      const right = this.parseMulDiv();
      left = next.value === "+" ? left + right : left - right;
    }

    return left;
  }

  private parseMulDiv(): number {
    let left = this.parseUnary();

    while (true) {
      const next = this.peek();

      if (next?.type !== "op" || (next.value !== "*" && next.value !== "/" && next.value !== "%")) {
        break;
      }

      this.consume();
      const right = this.parseUnary();

      if ((next.value === "/" || next.value === "%") && right === 0) {
        throw new RangeError("Division by zero is not allowed.");
      }

      if (next.value === "*") {
        left *= right;
      } else if (next.value === "/") {
        left /= right;
      } else {
        left %= right;
      }
    }

    return left;
  }

  private parseUnary(): number {
    const next = this.peek();

    if (next?.type === "op" && (next.value === "+" || next.value === "-")) {
      this.consume();
      this.enterDepth();
      try {
        const value = this.parseUnary();
        return next.value === "-" ? -value : value;
      } finally {
        this.leaveDepth();
      }
    }

    return this.parsePower();
  }

  private parsePower(): number {
    const base = this.parsePrimary();
    const next = this.peek();

    if (next?.type === "op" && next.value === "^") {
      this.consume();
      this.enterDepth();
      try {
        const exponent = this.parseUnary();
        return base ** exponent;
      } finally {
        this.leaveDepth();
      }
    }

    return base;
  }

  private parsePrimary(): number {
    const token = this.consume();

    if (token.type === "number") {
      return token.value;
    }

    if (token.type === "lparen") {
      this.enterDepth();
      try {
        const value = this.parseAddSub();
        const closing = this.consume();

        if (closing.type !== "rparen") {
          throw new SyntaxError('Expected closing ")" in math expression.');
        }

        return value;
      } finally {
        this.leaveDepth();
      }
    }

    if (token.type === "ident") {
      if (this.peek()?.type === "lparen") {
        const fn = FUNCTIONS.get(token.value);

        if (fn === undefined) {
          throw new Error(`Unknown math function "${token.value}".`);
        }

        this.consume();
        this.enterDepth();
        try {
          const args: number[] = [];

          if (this.peek()?.type !== "rparen") {
            while (true) {
              args.push(this.parseAddSub());

              if (this.peek()?.type === "comma") {
                this.consume();
                continue;
              }

              break;
            }
          }

          const closing = this.consume();

          if (closing.type !== "rparen") {
            throw new SyntaxError(`Expected closing ")" after arguments to ${token.value}.`);
          }

          return fn(args);
        } finally {
          this.leaveDepth();
        }
      }

      const constant = CONSTANTS.get(token.value);

      if (constant !== undefined) {
        return constant;
      }

      throw new Error(`Unknown identifier "${token.value}" in math expression.`);
    }

    throw new SyntaxError("Unexpected token in math expression.");
  }
}

function expectUnary(fn: (x: number) => number, name: string): (args: readonly number[]) => number {
  return (args) => {
    if (args.length !== 1) {
      throw new Error(`${name} requires exactly 1 argument.`);
    }

    return fn(args[0]!);
  };
}
