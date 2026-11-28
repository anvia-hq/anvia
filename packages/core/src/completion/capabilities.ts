import type { CompletionModel, CompletionRequest } from "./model";

/** Thrown when a request uses a capability the target model does not declare. */
export class CompletionCapabilityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CompletionCapabilityError";
  }
}

/** Validates a request against a model's declared capabilities; throws {@link CompletionCapabilityError}. */
export function assertCompletionRequestSupported(
  model: CompletionModel,
  request: CompletionRequest,
  options: { streaming?: boolean | undefined } = {},
): void {
  const modelLabel = `${model.provider}:${model.modelId}`;
  const capabilities = model.capabilities;

  assertCompletionControlsSupported(model, request.controls);

  if (options.streaming === true && !capabilities.streaming) {
    throw new CompletionCapabilityError(`${modelLabel} does not support streaming completions.`);
  }

  if (request.tools.length > 0 && !capabilities.tools) {
    throw new CompletionCapabilityError(`${modelLabel} does not support tool definitions.`);
  }

  if ((request.providerTools?.length ?? 0) > 0 && capabilities.providerTools !== true) {
    throw new CompletionCapabilityError(`${modelLabel} does not support provider-executed tools.`);
  }

  if (request.toolChoice !== undefined && !capabilities.toolChoice) {
    throw new CompletionCapabilityError(`${modelLabel} does not support tool choice.`);
  }

  if (
    request.toolChoice !== undefined &&
    isForcedToolChoice(request.toolChoice) &&
    capabilities.forcedToolChoice === false
  ) {
    throw new CompletionCapabilityError(`${modelLabel} does not support forced tool choice.`);
  }

  if (request.outputSchema !== undefined && !capabilities.outputSchema) {
    throw new CompletionCapabilityError(`${modelLabel} does not support output schemas.`);
  }

  if (request.temperature !== undefined && capabilities.temperature === false) {
    throw new CompletionCapabilityError(`${modelLabel} does not support temperature.`);
  }

  if (!capabilities.imageInput && requestHasImageInput(request)) {
    throw new CompletionCapabilityError(`${modelLabel} does not support image input.`);
  }

  if (!capabilities.documentInput && requestHasFileDocumentInput(request)) {
    throw new CompletionCapabilityError(`${modelLabel} does not support document file input.`);
  }
}

/** Validates control values against a model's controls; throws {@link CompletionCapabilityError}. */
export function assertCompletionControlsSupported(
  model: CompletionModel,
  controls: Readonly<Record<string, string | undefined>> | undefined,
): void {
  const modelLabel = `${model.provider}:${model.modelId}`;
  for (const [controlId, value] of Object.entries(controls ?? {})) {
    if (value === undefined) continue;

    const modelControls = model.controls;
    const control =
      modelControls !== undefined && Object.hasOwn(modelControls, controlId)
        ? modelControls[controlId]
        : undefined;

    if (control === undefined) {
      throw new CompletionCapabilityError(
        `${modelLabel} does not support completion control "${controlId}".`,
      );
    }

    if (!control.options.includes(value)) {
      throw new CompletionCapabilityError(
        `${modelLabel} completion control "${controlId}" does not support value "${value}".`,
      );
    }
  }
}

function isForcedToolChoice(toolChoice: NonNullable<CompletionRequest["toolChoice"]>): boolean {
  return toolChoice === "required" || typeof toolChoice === "object";
}

function requestHasImageInput(request: CompletionRequest): boolean {
  return request.chatHistory.some((message) =>
    message.role === "system" || typeof message.content === "string"
      ? false
      : message.content.some((content) => content.type === "image"),
  );
}

function requestHasFileDocumentInput(request: CompletionRequest): boolean {
  return request.chatHistory.some((message) =>
    message.role === "user" && typeof message.content !== "string"
      ? message.content.some((content) => content.type === "file" && content.data.type !== "text")
      : false,
  );
}
