# MCP Safety

Streamable HTTP connections enforce Anvia URL safety by default:

- No custom `fetch`. The transport owns its HTTP method, body, abort signal,
  session, and protocol headers — arbitrary `RequestInit` fields are not exposed.
- Static headers are explicit transport config. They are sent only to the exact
  MCP endpoint, never attached to OAuth requests, and endpoint redirects fail
  instead of forwarding credentials.
- A static `authorization` header cannot be combined with `authProvider`.

## Private networks

For an intentionally local or private-network server, set
`ssrfProtection: "disabled"` on that transport. This lifts hostname and DNS
restrictions for the whole transport — redirects and OAuth discovery included —
while still requiring HTTP(S). Use it only when the application owns and trusts
that network boundary, and expect `check-mcp.sh` to flag it for review.

## Instructions are metadata

MCP server instructions remain inspectable metadata; they are not added to Agent
instructions. If a server's behavior matters, write it into your own
`instructions` or tool descriptions — never assume the agent has seen the
server's text.
