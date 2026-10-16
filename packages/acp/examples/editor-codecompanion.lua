-- Template: run write-editor-configs.mjs to substitute absolute paths.
-- Merge this adapter into an existing CodeCompanion setup; do not replace other settings.
require("codecompanion").setup({
  adapters = {
    acp = {
      anvia_smoke = function()
        return {
          name = "anvia_smoke",
          formatted_name = "Anvia smoke",
          type = "acp",
          roles = { llm = "assistant", user = "user" },
          commands = { default = { "@NODE@", "@CLI@", "@AGENT@" } },
          defaults = {
            timeout = 20000,
            mcpServers = {
              { name = "anvia-smoke", command = "@NODE@", args = { "@MCP@" }, env = {} },
            },
          },
          parameters = { protocolVersion = 1, clientCapabilities = {} },
          handlers = {
            setup = function() return true end,
            auth = function() return true end, -- The offline factory needs no credentials.
            form_messages = function(self, messages, capabilities)
              return require("codecompanion.adapters.acp.helpers").form_messages(self, messages, capabilities)
            end,
            on_exit = function() end,
          },
        }
      end,
    },
  },
})
