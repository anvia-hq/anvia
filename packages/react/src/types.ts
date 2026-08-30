import type {
  ClientDataMap,
  ClientInteraction,
  ClientMetadata,
  ClientStreamCursor,
  ClientStreamEvent,
  ClientStreamRequest,
  ClientTransport,
  CreateUIAttachment,
  UIMessage,
} from "@anvia/client";
import type { AgentInteractionResponse } from "@anvia/core/agent/interactions";
import type { ContextUsage, Usage } from "@anvia/core/completion";

export type AnyClientTransport = ClientTransport<
  ClientStreamRequest,
  ClientDataMap,
  ClientMetadata
>;

type TransportTypes<Transport extends AnyClientTransport> = NonNullable<Transport["_types"]>;

export type TransportData<Transport extends AnyClientTransport> = TransportTypes<Transport>["data"];

export type TransportMetadata<Transport extends AnyClientTransport> =
  TransportTypes<Transport>["metadata"];

export type ChatResumeCursor = ClientStreamCursor;
export type ChatResumeStorage = "sessionStorage" | "localStorage" | Storage;

export type ChatResumeOptions = {
  key: string;
  storage?: ChatResumeStorage;
  auto?: boolean;
};

export type ChatResumeState<
  Metadata extends ClientMetadata = ClientMetadata,
  Data extends ClientDataMap = ClientDataMap,
> = {
  version: 3;
  streamId: string;
  lastEventId: number;
  messages: readonly UIMessage<Metadata, Data>[];
  interactions: readonly ClientInteraction[];
  request: ClientStreamRequest<Metadata>;
};

export type ChatSuggestion<Metadata extends ClientMetadata = ClientMetadata> = {
  id: string;
  prompt: string;
  label?: string;
  metadata?: Metadata;
};

export type SendMessageInput<Metadata extends ClientMetadata = ClientMetadata> = {
  text?: string;
  attachments?: readonly CreateUIAttachment[];
  metadata?: Metadata;
};

export type UseChatStatus = "ready" | "submitted" | "streaming" | "waiting" | "error";

export type UseChatOptions<Transport extends AnyClientTransport = ClientTransport> = {
  transport: Transport;
  initialMessages?: readonly UIMessage<TransportMetadata<Transport>, TransportData<Transport>>[];
  resume?: ChatResumeOptions;
  suggestions?: readonly ChatSuggestion<TransportMetadata<Transport>>[];
  onEvent?(event: ClientStreamEvent<TransportMetadata<Transport>, TransportData<Transport>>): void;
  onError?(error: Error): void;
};

export type SetMessages<Metadata extends ClientMetadata, Data extends ClientDataMap> = (
  messages:
    | readonly UIMessage<Metadata, Data>[]
    | ((messages: readonly UIMessage<Metadata, Data>[]) => readonly UIMessage<Metadata, Data>[]),
) => void;

export type UseChatResult<Transport extends AnyClientTransport = ClientTransport> = {
  messages: readonly UIMessage<TransportMetadata<Transport>, TransportData<Transport>>[];
  events: readonly ClientStreamEvent<TransportMetadata<Transport>, TransportData<Transport>>[];
  runUsage?: Usage | undefined;
  contextUsage: ContextUsage | undefined;
  suggestions: readonly ChatSuggestion<TransportMetadata<Transport>>[];
  setMessages: SetMessages<TransportMetadata<Transport>, TransportData<Transport>>;
  sendMessage(input: SendMessageInput<TransportMetadata<Transport>>): Promise<void>;
  regenerate(): Promise<void>;
  stop(): void;
  reset(): void;
  status: UseChatStatus;
  error: Error | undefined;
  text: string;
  streamId: string | undefined;
  isResuming: boolean;
  resume(): Promise<void>;
  interactions: {
    all: readonly ClientInteraction[];
    pending: readonly ClientInteraction[];
  };
  respondingInteractions: ReadonlySet<string>;
  respondToInteraction(options: {
    interactionId: string;
    response: AgentInteractionResponse;
  }): Promise<void>;
};
