import { describe, expect, it } from "vitest";
import {
  Agent,
  AssistantContent,
  Usage,
  assertAgentInteractionResponse,
  createQuestionTool,
  DEFAULT_QUESTION_TOOL_DESCRIPTION,
  DEFAULT_QUESTION_TOOL_NAME,
  isQuestionTool,
  parseAgentContinuation,
  parseAgentInteractionRequest,
  type CompletionRequest,
  type JsonObject,
  type QuestionToolInput,
} from "./helpers/imports";
import { parseAgentQuestionPrompts } from "../src/agent/interactions";

const question = (id = "format") => ({ id, text: "Which format should I use?" });
const choices = (count: number) =>
  Array.from({ length: count }, (_, index) => ({
    label: `Format ${index}`,
    value: `format_${index}`,
  }));

function askingAgent(input: JsonObject, tool = createQuestionTool()) {
  const requests: CompletionRequest[] = [];
  const agent = new Agent({
    id: "questions",
    tools: [tool],
    model: {
      provider: "test",
      modelId: "questions",
      capabilities: {
        streaming: false,
        tools: true,
        toolChoice: true,
        imageInput: false,
        documentInput: false,
        outputSchema: false,
        reasoning: false,
      },
      completion: async (request) => {
        requests.push(request);
        return {
          choice:
            requests.length === 1
              ? [AssistantContent.toolCall("question_call", tool.name, input)]
              : [AssistantContent.text("done")],
          usage: Usage.empty(),
          rawResponse: {},
        };
      },
    },
  });
  return { agent, requests };
}

describe("createQuestionTool", () => {
  it.each([undefined, {}])(
    "applies defaults with options %j and remains a question tool",
    async (options) => {
      const tool = createQuestionTool(options);
      expect(DEFAULT_QUESTION_TOOL_NAME).toBe("ask_user");
      expect(DEFAULT_QUESTION_TOOL_DESCRIPTION).toContain(
        "wait for their answers before continuing",
      );
      expect(await tool.definition("")).toMatchObject({
        name: "ask_user",
        description: DEFAULT_QUESTION_TOOL_DESCRIPTION,
        parameters: {
          properties: {
            questions: {
              minItems: 1,
              maxItems: 4,
              items: { properties: { choices: { minItems: 2, maxItems: 4 } } },
            },
          },
        },
      });
      expect(isQuestionTool(tool)).toBe(true);
      expect(isQuestionTool({ name: "ask_user" })).toBe(false);
      await expect(tool.call({ questions: [question()] })).rejects.toThrow("Agent interaction");
    },
  );

  it.each([
    [{ name: "clarify", description: "Custom instructions" }, "clarify", "Custom instructions"],
    [{ name: "clarify" }, "clarify", DEFAULT_QUESTION_TOOL_DESCRIPTION],
    [{ description: "Custom instructions" }, "ask_user", "Custom instructions"],
    [{ name: "" }, "", DEFAULT_QUESTION_TOOL_DESCRIPTION],
    [{ description: "" }, "ask_user", ""],
    [{ name: "  ", description: "  " }, "  ", "  "],
  ] as const)("respects independent overrides %j", async (options, name, description) => {
    expect(await createQuestionTool(options).definition("")).toMatchObject({ name, description });
  });

  it.each([
    ["no questions", [], "at least 1 question"],
    [
      "too many questions",
      Array.from({ length: 5 }, (_, index) => question(String(index))),
      "no more than 4 questions",
    ],
    ["duplicate IDs", [question(), question()], "Question IDs must be unique"],
    [
      "duplicate IDs after trimming",
      [question(), question(" format ")],
      "Question IDs must be unique",
    ],
    ["empty ID", [question("")], "Question IDs must not be empty"],
    ["blank ID", [question("  ")], "Question IDs must not be empty"],
    ["empty text", [{ ...question(), text: "" }], "Question text must not be empty"],
    ["blank text", [{ ...question(), text: "  " }], "Question text must not be empty"],
    [
      "free text with custom answers disabled",
      [{ ...question(), allowCustom: false }],
      "A free-text question cannot disable custom answers",
    ],
    ["no choices", [{ ...question(), choices: [] }], "at least 2 choices"],
    ["one choice", [{ ...question(), choices: choices(1) }], "at least 2 choices"],
    ["too many choices", [{ ...question(), choices: choices(5) }], "no more than 4 choices"],
    [
      "duplicate choice values",
      [
        {
          ...question(),
          choices: [
            { label: "A", value: "a" },
            { label: "B", value: "a" },
          ],
        },
      ],
      "choice values must be unique",
    ],
    [
      "duplicate choice values after trimming",
      [
        {
          ...question(),
          choices: [
            { label: "A", value: "a" },
            { label: "B", value: " a " },
          ],
        },
      ],
      "choice values must be unique",
    ],
    [
      "empty label",
      [
        {
          ...question(),
          choices: [
            { label: "", value: "a" },
            { label: "B", value: "b" },
          ],
        },
      ],
      "Question choice labels must not be empty",
    ],
    [
      "blank label",
      [
        {
          ...question(),
          choices: [
            { label: "  ", value: "a" },
            { label: "B", value: "b" },
          ],
        },
      ],
      "Question choice labels must not be empty",
    ],
    [
      "empty value",
      [
        {
          ...question(),
          choices: [
            { label: "A", value: "" },
            { label: "B", value: "b" },
          ],
        },
      ],
      "Question choice values must not be empty",
    ],
    [
      "blank value",
      [
        {
          ...question(),
          choices: [
            { label: "A", value: "  " },
            { label: "B", value: "b" },
          ],
        },
      ],
      "Question choice values must not be empty",
    ],
  ])("rejects %s at the tool input boundary", (_, questions, message) => {
    expect(() => createQuestionTool().parseInput!({ questions })).toThrow(String(message));
  });

  it.each([1, 4])("accepts %i questions and trims nonblank fields", (count) => {
    const questions = Array.from({ length: count }, (_, index) => ({
      id: ` q_${index} `,
      text: " Question? ",
      ...(index === 0 ? {} : { choices: choices(index === 1 ? 2 : 4) }),
    }));
    expect(createQuestionTool().parseInput!({ questions }).questions[0]).toEqual({
      id: "q_0",
      text: "Question?",
    });
  });

  it("suspends and resumes with the answers delivered to the fake model as a tool result", async () => {
    const { agent, requests } = askingAgent({
      questions: [
        { ...question(), choices: choices(2) },
        { id: "details", text: "What details do you need?" },
      ],
    });
    const pending = await agent.generate({ prompt: "Prepare a report" });
    if (pending.type !== "interaction") throw new Error("Expected question interaction");
    expect(pending.interaction).toMatchObject({
      type: "tool-question",
      toolName: "ask_user",
      toolCallId: "question_call",
    });
    const answers = [
      { questionId: "format", value: "format_0" },
      { questionId: "details", value: "An incident timeline" },
    ];
    const result = await agent.generate({
      continuation: parseAgentContinuation(JSON.parse(JSON.stringify(pending.continuation))),
      response: { type: "tool-question", answers },
    });
    expect(result).toMatchObject({ type: "response", output: "done" });
    expect(requests[1]?.chatHistory.at(-1)).toEqual({
      role: "tool",
      content: [
        {
          type: "tool-result",
          toolCallId: "question_call",
          toolName: "ask_user",
          output: { type: "json", value: { answers } },
        },
      ],
    });
  });

  it("returns schema errors to the model without pausing for invalid questions", async () => {
    const { agent, requests } = askingAgent({
      questions: [{ ...question(), choices: choices(1) }],
    });
    expect(await agent.generate({ prompt: "Ask me" })).toMatchObject({
      type: "response",
      output: "done",
    });
    expect(requests[1]?.chatHistory.at(-1)).toMatchObject({
      role: "tool",
      content: [
        { output: { type: "error-text", value: expect.stringContaining("at least 2 choices") } },
      ],
    });
  });

  it.each([
    ["five questions", Array.from({ length: 5 }, (_, index) => question(String(index)))],
    ["one choice", [{ ...question(), choices: choices(1) }]],
    ["five choices", [{ ...question(), choices: choices(5) }]],
  ])("still parses and resumes stored continuations containing %s", async (_, questions) => {
    // Simulate the old tool input parser while retaining the real question-tool marker.
    const legacyTool = createQuestionTool();
    legacyTool.parseInput = (args) => ({
      questions: parseAgentQuestionPrompts((args as JsonObject).questions),
    });
    const { agent, requests } = askingAgent({ questions }, legacyTool);
    const pending = await agent.generate({ prompt: "Legacy question" });
    if (pending.type !== "interaction") throw new Error("Expected legacy interaction");
    expect(parseAgentInteractionRequest(JSON.parse(JSON.stringify(pending.interaction)))).toEqual(
      pending.interaction,
    );
    const continuation = parseAgentContinuation(JSON.parse(JSON.stringify(pending.continuation)));
    const currentTool = createQuestionTool();
    expect(() => currentTool.parseInput!({ questions })).toThrow();
    const restored = new Agent({ id: agent.id, model: agent.model, tools: [currentTool] });
    const answers = (questions as QuestionToolInput["questions"]).map((item) => ({
      questionId: item.id,
      value: item.choices?.[0]?.value ?? "Answer",
    }));
    expect(
      await restored.generate({ continuation, response: { type: "tool-question", answers } }),
    ).toMatchObject({ type: "response", output: "done" });
    expect(requests[1]?.chatHistory.at(-1)).toMatchObject({
      content: [{ output: { type: "json", value: { answers } } }],
    });
  });
});

describe("question response validation", () => {
  const request = (allowCustom?: boolean) =>
    parseAgentInteractionRequest({
      type: "tool-question",
      id: "interaction",
      toolName: "ask_user",
      toolCallId: "call",
      internalCallId: "internal",
      questions: [
        {
          ...question(),
          choices: choices(2),
          ...(allowCustom === undefined ? {} : { allowCustom }),
        },
      ],
    });

  it.each([
    ["unknown ID", [{ questionId: "unknown", value: "format_0" }]],
    ["missing answer", []],
    [
      "duplicate ID",
      [
        { questionId: "format", value: "format_0" },
        { questionId: "format", value: "format_1" },
      ],
    ],
    [
      "extra unknown ID",
      [
        { questionId: "format", value: "format_0" },
        { questionId: "unknown", value: "format_0" },
      ],
    ],
    ["blank answer", [{ questionId: "format", value: "  " }]],
  ])("rejects %s", (_, answers) => {
    expect(() =>
      assertAgentInteractionResponse(request(), { type: "tool-question", answers }),
    ).toThrow();
  });

  it.each([undefined, false, true])(
    "allows custom choices only when allowCustom is true (%s)",
    (allowCustom) => {
      const validate = () =>
        assertAgentInteractionResponse(request(allowCustom), {
          type: "tool-question",
          answers: [{ questionId: "format", value: "custom" }],
        });
      if (allowCustom === true) expect(validate).not.toThrow();
      else expect(validate).toThrow("configured choices");
    },
  );
});
