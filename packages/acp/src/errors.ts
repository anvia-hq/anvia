/** Adapter errors contain only fixed, safe kinds; causes never cross the wire. */
export const errorCodes = {
  not_initialized: -32600,
  already_initialized: -32600,
  session_busy: -32600,
  session_not_found: -32002,
  invalid_cwd: -32602,
  policy_denied: -32602,
  unsupported_content: -32602,
  invalid_content: -32602,
  unsupported_mcp: -32602,
  resource_limit: -32602,
  configuration_error: -32603,
  execution_failed: -32603,
  invalid_interaction_response: -32603,
  unsupported_interaction: -32603,
  connection_closed: -32800,
} as const;

export class AcpError extends Error {
  constructor(readonly kind: keyof typeof errorCodes) {
    super(kind);
    this.name = "AcpError";
  }
}
