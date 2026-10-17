import { Agent } from "@anvia/core/agent";
import { Usage } from "@anvia/core/completion";

// Offline fixture model: no credentials, tools, or network access.
export default new Agent({
  id: "acp-sample",
  model: {
    provider: "fixture",
    modelId: "offline",
    capabilities: { streaming: false, tools: false },
    async completion() {
      return {
        choice: [{ type: "text", text: "Hello from the ACP sample agent." }],
        usage: Usage.empty(),
        rawResponse: {},
      };
    },
  },
});
