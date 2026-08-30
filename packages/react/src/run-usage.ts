import type { ClientDataMap, ClientMetadata, ClientStreamEvent } from "@anvia/client";
import type { Usage } from "@anvia/core/completion";

export function runUsageUpdateFromEvent<
  Metadata extends ClientMetadata,
  Data extends ClientDataMap,
>(event: ClientStreamEvent<Metadata, Data>): Usage | undefined {
  return event.type === "run_end" || event.type === "error" ? event.usage : undefined;
}
