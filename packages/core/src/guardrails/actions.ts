import type {
  GuardrailActionBase,
  GuardrailAllow,
  GuardrailBlock,
  GuardrailCommonActions,
  InputGuardrailActions,
  OutputGuardrailActions,
} from "./types";

export function allow(options: GuardrailActionBase = {}): GuardrailAllow {
  return { action: "allow", ...options };
}

export function block(options: Omit<GuardrailBlock, "action">): GuardrailBlock {
  return { action: "block", ...options };
}

const commonActions: GuardrailCommonActions = {
  allow,
  block,
};

export const inputActions: InputGuardrailActions = {
  ...commonActions,
  rewrite(options) {
    return { action: "rewrite", ...options };
  },
};

export const outputActions: OutputGuardrailActions = {
  ...commonActions,
  rewrite(options) {
    return { action: "rewrite", ...options };
  },
};
