export type EventStreamFormat = "jsonl" | "sse";

export type TransportOptions = {
  signal?: AbortSignal;
  headers?: HeadersInit;
};

export type EventTransport<TRequest, TEvent> = {
  send(request: TRequest, options?: TransportOptions): AsyncIterable<TEvent>;
};

export type ChatRole = "system" | "user" | "assistant" | "tool";

export type ChatMessage = {
  id: string;
  role: ChatRole;
  content: string;
  metadata?: unknown;
};

export type DefaultChatRequest = {
  message: string;
  history: ChatMessage[];
  stream: true;
};

export type UseChatStatus = "idle" | "streaming" | "error";

export type UseChatOptions<
  TRequest = DefaultChatRequest,
  TEvent = unknown,
  TMessage extends ChatMessage = ChatMessage,
> = {
  transport?: EventTransport<TRequest, TEvent>;
  endpoint?: string | URL;
  format?: EventStreamFormat;
  initialMessages?: TMessage[];
  createRequest?: (input: string, messages: TMessage[]) => TRequest;
  eventToDelta?: (event: TEvent) => string | undefined;
  eventToFinal?: (event: TEvent) => string | undefined;
  onEvent?: (event: TEvent) => void;
  onError?: (error: unknown) => void;
};

export type UseChatResult<TEvent = unknown, TMessage extends ChatMessage = ChatMessage> = {
  messages: TMessage[];
  events: TEvent[];
  input: string;
  setInput(input: string): void;
  send(input?: string): Promise<void>;
  stop(): void;
  reset(messages?: TMessage[]): void;
  status: UseChatStatus;
  error: unknown;
  text: string;
};
