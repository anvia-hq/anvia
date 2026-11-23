import { isPlainObject } from "../utils";

/**
 * Anthropic prompt-cache TTL. `5m` is the default and the value Anthropic assumes when a
 * breakpoint omits `ttl`. `1h` opts into the extended cache.
 */
export type AnthropicPromptCacheTtl = "5m" | "1h";

export type AnthropicPromptCacheOptions = {
  ttl?: AnthropicPromptCacheTtl | undefined;
};

export type AnthropicPromptCacheSettings = boolean | AnthropicPromptCacheOptions;

const MAX_CACHE_BREAKPOINTS = 4;

/**
 * Content block types that accept `cache_control`. Thinking blocks do not.
 */
const CACHEABLE_BLOCK_TYPES = new Set(["text", "image", "document", "tool_use", "tool_result"]);

/**
 * Adds Anthropic prompt-cache breakpoints to Messages params.
 *
 * The breakpoints sit at the end of each widening prefix — the last tool definition, the
 * system prompt, and the last cacheable block of the conversation — so a later turn reads the
 * whole input prefix from cache and only writes the tokens after the previous breakpoint.
 * Anthropic accepts at most four breakpoints per request, and markers already present in
 * `params` count towards that limit. A section whose last block already carries a marker is
 * left alone, so running the transform twice changes nothing.
 *
 * Anthropic ignores a breakpoint whose prefix is below the model's minimum cacheable length
 * (1024 tokens on Claude Sonnet and Opus, 4096 on Claude Haiku 4.5). Cache reads and writes
 * are reported as `cachedInputTokens` and `cacheCreationInputTokens` in `Usage`.
 */
export function withAnthropicPromptCache(
  params: Record<string, unknown>,
  options: AnthropicPromptCacheOptions = {},
): Record<string, unknown> {
  const cacheControl = cacheControlFrom(options);
  let remaining = MAX_CACHE_BREAKPOINTS - countCacheBreakpoints(params);

  if (remaining <= 0) return params;

  let result = params;

  if (remaining > 0 && Array.isArray(result.tools) && result.tools.length > 0) {
    const index = result.tools.length - 1;
    const tool = result.tools[index];

    if (isPlainObject(tool) && tool.cache_control === undefined) {
      result = { ...result, tools: withBlockCacheControl(result.tools, index, cacheControl) };
      remaining -= 1;
    }
  }

  if (remaining > 0) {
    const system = withSystemCacheControl(result.system, cacheControl);

    if (system !== undefined) {
      result = { ...result, system };
      remaining -= 1;
    }
  }

  if (remaining > 0 && Array.isArray(result.messages)) {
    const messages = withMessagesCacheControl(result.messages, cacheControl);

    if (messages !== undefined) {
      result = { ...result, messages };
    }
  }

  return result;
}

/**
 * Normalizes a model-level `promptCache` setting. `true` uses the default breakpoints,
 * `false` and `undefined` disable caching, and an options object customizes the TTL.
 */
export function anthropicPromptCacheOptions(
  settings: AnthropicPromptCacheSettings | undefined,
): AnthropicPromptCacheOptions | undefined {
  if (settings === undefined || settings === false) return undefined;

  if (settings === true) return {};

  cacheControlFrom(settings);
  return settings;
}

function cacheControlFrom(options: AnthropicPromptCacheOptions): Record<string, unknown> {
  const ttl = options.ttl;

  if (ttl === undefined || ttl === "5m") {
    return { type: "ephemeral" };
  }

  if (ttl !== "1h") {
    throw new TypeError('Anthropic prompt cache ttl must be "5m" or "1h".');
  }

  return { type: "ephemeral", ttl };
}

function withSystemCacheControl(
  system: unknown,
  cacheControl: Record<string, unknown>,
): unknown[] | undefined {
  if (typeof system === "string") {
    return system.length === 0
      ? undefined
      : [{ type: "text", text: system, cache_control: cacheControl }];
  }

  if (!Array.isArray(system)) return undefined;

  const index = lastCacheableIndex(system);

  if (index === -1) return undefined;

  const block = system[index];

  if (!isPlainObject(block) || block.cache_control !== undefined) return undefined;

  return withBlockCacheControl(system, index, cacheControl);
}

/**
 * Places one breakpoint on the last cacheable block of the conversation. A block that already
 * carries a breakpoint ends the prefix, so the section is left alone instead of moving the
 * marker onto an earlier block.
 */
function withMessagesCacheControl(
  messages: unknown[],
  cacheControl: Record<string, unknown>,
): unknown[] | undefined {
  for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex -= 1) {
    const message = messages[messageIndex];

    if (!isPlainObject(message)) continue;

    if (typeof message.content === "string") {
      if (message.content.length === 0) continue;

      return replaceAt(messages, messageIndex, {
        ...message,
        content: [{ type: "text", text: message.content, cache_control: cacheControl }],
      });
    }

    if (!Array.isArray(message.content)) continue;

    const blockIndex = lastCacheableIndex(message.content);

    if (blockIndex === -1) continue;

    const block = message.content[blockIndex];

    if (!isPlainObject(block) || block.cache_control !== undefined) return undefined;

    return replaceAt(messages, messageIndex, {
      ...message,
      content: withBlockCacheControl(message.content, blockIndex, cacheControl),
    });
  }

  return undefined;
}

function lastCacheableIndex(blocks: unknown[]): number {
  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    const block = blocks[index];

    if (!isPlainObject(block)) continue;

    if (typeof block.type !== "string" || !CACHEABLE_BLOCK_TYPES.has(block.type)) continue;

    return index;
  }
  return -1;
}

function withBlockCacheControl(
  blocks: unknown[],
  index: number,
  cacheControl: Record<string, unknown>,
): unknown[] {
  const block = blocks[index];

  if (!isPlainObject(block)) return blocks;

  return replaceAt(blocks, index, { ...block, cache_control: cacheControl });
}

function replaceAt(values: unknown[], index: number, value: unknown): unknown[] {
  const copy = values.slice();
  copy[index] = value;
  return copy;
}

function countCacheBreakpoints(params: Record<string, unknown>): number {
  let count = 0;

  if (Array.isArray(params.tools)) {
    count += params.tools.filter(hasCacheControl).length;
  }

  if (Array.isArray(params.system)) {
    count += params.system.filter(hasCacheControl).length;
  }

  if (Array.isArray(params.messages)) {
    for (const message of params.messages) {
      if (!isPlainObject(message) || !Array.isArray(message.content)) continue;

      for (const block of message.content) {
        count += countBlockBreakpoints(block);
      }
    }
  }

  return count;
}

/**
 * Counts a marker on the block itself and on any content nested in a tool result.
 */
function countBlockBreakpoints(block: unknown): number {
  if (!isPlainObject(block)) return 0;

  let count = block.cache_control === undefined ? 0 : 1;

  if (Array.isArray(block.content)) {
    count += block.content.filter(hasCacheControl).length;
  }

  return count;
}

function hasCacheControl(value: unknown): boolean {
  return isPlainObject(value) && value.cache_control !== undefined;
}
