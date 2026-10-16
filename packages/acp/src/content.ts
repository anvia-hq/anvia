import type { UserContentPart, UserMessage } from "@anvia/core/completion";
import { AcpError } from "./errors.js";
import type { AcpLimits } from "./types.js";

/** Protocol-independent input; the wire adapter drops unsupported metadata before conversion. */
export type PromptBlock =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string }
  | { type: "resource_link"; uri: string; name: string; description?: string }
  | { type: "unsupported" };

export function convertPrompt(
  blocks: readonly PromptBlock[],
  limits: AcpLimits,
  images: boolean,
): UserMessage {
  if (blocks.length === 0) throw new AcpError("invalid_content");
  if (blocks.length > limits.maxContentBlocks) throw new AcpError("resource_limit");
  let textBytes = 0;
  let totalBytes = 0;
  const content: UserContentPart[] = [];
  for (const block of blocks) {
    switch (block.type) {
      case "text":
      case "resource_link": {
        const text =
          block.type === "text"
            ? block.text
            : `Resource reference: ${JSON.stringify({
                name: block.name,
                uri: block.uri,
                description: block.description,
              })}`;
        const bytes = Buffer.byteLength(text, "utf8");
        textBytes += bytes;
        totalBytes += bytes;
        content.push({ type: "text", text });
        break;
      }
      case "image": {
        if (!images) throw new AcpError("unsupported_content");
        if (!/^image\/(png|jpeg|gif|webp)$/.test(block.mimeType)) {
          throw new AcpError("unsupported_content");
        }
        // Bound encoded input before decoding. Buffer alone tolerates malformed base64.
        if (block.data.length > 4 * Math.ceil(limits.maxImageBytes / 3)) {
          throw new AcpError("resource_limit");
        }
        if (
          !block.data.length ||
          block.data.length % 4 !== 0 ||
          !/^[A-Za-z0-9+/]*={0,2}$/.test(block.data)
        ) {
          throw new AcpError("invalid_content");
        }
        const decoded = Buffer.from(block.data, "base64");
        if (decoded.length > limits.maxImageBytes) throw new AcpError("resource_limit");
        if (decoded.toString("base64") !== block.data) throw new AcpError("invalid_content");
        totalBytes += block.data.length;
        content.push({
          type: "image",
          image: { type: "data", data: block.data },
          mediaType: block.mimeType,
        });
        break;
      }
      default:
        throw new AcpError("unsupported_content");
    }
    if (textBytes > limits.maxTextBytes || totalBytes > limits.maxPromptBytes) {
      throw new AcpError("resource_limit");
    }
  }
  return { role: "user", content };
}
