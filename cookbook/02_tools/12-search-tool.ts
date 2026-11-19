import assert from "node:assert/strict";
import { Agent } from "@anvia/core/agent";
import {
  type CompletionModel,
  type CompletionRequest,
  type CompletionResponse,
  Usage,
} from "@anvia/core/completion";
import { searchTool } from "@anvia/core/tool";

class InspectingModel implements CompletionModel {
  readonly provider = "cookbook";
  readonly modelId = "search-tool";
  readonly capabilities = {
    streaming: false,
    tools: true,
    toolChoice: true,
    imageInput: false,
    documentInput: false,
    outputSchema: false,
    reasoning: false,
  };
  readonly requests: CompletionRequest[] = [];
  private calls = 0;

  async completion(request: CompletionRequest): Promise<CompletionResponse> {
    this.requests.push(request);
    this.calls += 1;
    return {
      choice:
        this.calls === 1
          ? [
              {
                type: "tool-call",
                toolCallId: "call_1",
                toolName: "search_runbooks",
                input: { query: "the deploy came back with errors" },
              },
            ]
          : [{ type: "text", text: "Roll back the canary, then retry the promote." }],
      usage: Usage.empty(),
      rawResponse: {},
    };
  }
}

const runbooks = [
  {
    id: "rollback",
    text: "Roll back a deployment",
    detail: "1. Scale the canary to zero. 2. Point traffic at the previous revision.",
  },
  {
    id: "incident",
    text: "Start an incident",
    detail: "1. Page the on-call. 2. Open the incident channel. 3. Assign a commander.",
  },
  {
    id: "refund",
    text: "Refund a customer",
    detail: "1. Verify the order. 2. Issue the refund in the billing console.",
  },
];

const model = new InspectingModel();

const agent = new Agent({
  id: "ops",
  model,
  tools: [searchTool({ name: "search_runbooks", entities: runbooks, topK: 2 })],
});

const result = await agent.generate({ prompt: "I think I broke the deploy, what do I do?" });

const offered = model.requests[0]?.tools.map((tool) => tool.name) ?? [];
console.log("tools offered:", offered.join(", "));
assert.deepEqual(offered, ["search_runbooks"]);

const toolMessage = model.requests[1]?.chatHistory?.at(-1);
console.log("tool returned:", JSON.stringify(toolMessage));
assert.ok(JSON.stringify(toolMessage).includes("Scale the canary to zero"));

console.log("answer:", result.text);
